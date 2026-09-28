"""
Tests for realtime.voice_identity — the signed, call-bound voice identity token.

The security properties under test, in order of importance:
  * a token minted for call A is rejected on call B (anti-replay),
  * tampering is rejected,
  * expiry is enforced,
  * the live User row is re-read, so a deactivated account cannot ride a token that
    was valid when minted.
"""

from django.contrib.auth import get_user_model
from django.core import signing
from django.test import TestCase, override_settings

from realtime.voice_identity import (
    IDENTITY_SALT,
    REASON_BAD_SIGNATURE,
    REASON_CALL_MISMATCH,
    REASON_EXPIRED,
    REASON_MISSING,
    IdentityError,
    load_user,
    mint_identity_token,
    read_identity_token,
    resolve_user_sync,
    user_pk_from_twilio_from,
)

User = get_user_model()

CALL_A = "CA" + "1" * 32
CALL_B = "CA" + "2" * 32


class UserPkFromTwilioFromTests(TestCase):
    def test_client_identity_parses_to_pk(self):
        self.assertEqual(user_pk_from_twilio_from("client:42"), 42)

    def test_inbound_pstn_number_is_not_an_identity(self):
        """Inbound PSTN calls have From=<phone>, so identity never resolves."""
        self.assertIsNone(user_pk_from_twilio_from("+15551234567"))

    def test_empty_returns_none(self):
        self.assertIsNone(user_pk_from_twilio_from(""))

    def test_non_numeric_client_returns_none(self):
        self.assertIsNone(user_pk_from_twilio_from("client:abc"))

    def test_bare_client_prefix_returns_none(self):
        self.assertIsNone(user_pk_from_twilio_from("client:"))

    def test_whitespace_is_tolerated(self):
        self.assertEqual(user_pk_from_twilio_from("client: 7 "), 7)

    def test_negative_and_decimal_are_rejected(self):
        self.assertIsNone(user_pk_from_twilio_from("client:-1"))
        self.assertIsNone(user_pk_from_twilio_from("client:1.5"))


class TokenRoundTripTests(TestCase):
    def test_mint_then_read_returns_the_pk(self):
        token = mint_identity_token(99, CALL_A)
        self.assertEqual(read_identity_token(token, CALL_A), 99)

    def test_empty_token_reports_missing(self):
        with self.assertRaises(IdentityError) as ctx:
            read_identity_token("", CALL_A)
        self.assertEqual(ctx.exception.reason, REASON_MISSING)

    def test_tampered_token_is_rejected(self):
        token = mint_identity_token(99, CALL_A)
        tampered = token[:-3] + ("aaa" if not token.endswith("aaa") else "bbb")
        with self.assertRaises(IdentityError) as ctx:
            read_identity_token(tampered, CALL_A)
        self.assertEqual(ctx.exception.reason, REASON_BAD_SIGNATURE)

    def test_token_for_another_call_is_rejected(self):
        """The anti-replay guard: a captured token is useless on any other call."""
        token = mint_identity_token(99, CALL_A)
        with self.assertRaises(IdentityError) as ctx:
            read_identity_token(token, CALL_B)
        self.assertEqual(ctx.exception.reason, REASON_CALL_MISMATCH)

    @override_settings(VOICE_IDENTITY_MAX_AGE=-1)
    def test_expired_token_is_rejected(self):
        # A negative max_age makes any token older than "now plus a second" stale,
        # which is the cheapest way to exercise SignatureExpired without freezing time.
        token = mint_identity_token(99, CALL_A)
        with self.assertRaises(IdentityError) as ctx:
            read_identity_token(token, CALL_A)
        self.assertEqual(ctx.exception.reason, REASON_EXPIRED)

    @override_settings(VOICE_IDENTITY_MAX_AGE=120)
    def test_fresh_token_is_accepted_within_max_age(self):
        self.assertEqual(read_identity_token(mint_identity_token(1, CALL_A), CALL_A), 1)

    def test_a_token_signed_with_another_salt_is_rejected(self):
        foreign = signing.dumps({"u": 1, "c": CALL_A}, salt="some.other.salt")
        with self.assertRaises(IdentityError) as ctx:
            read_identity_token(foreign, CALL_A)
        self.assertEqual(ctx.exception.reason, REASON_BAD_SIGNATURE)

    def test_a_non_dict_payload_is_rejected(self):
        token = signing.dumps("just-a-string", salt=IDENTITY_SALT)
        with self.assertRaises(IdentityError) as ctx:
            read_identity_token(token, CALL_A)
        self.assertEqual(ctx.exception.reason, REASON_BAD_SIGNATURE)

    def test_a_non_int_pk_is_rejected(self):
        """Guards against a string pk being used to smuggle a lookup expression."""
        token = signing.dumps({"u": "42", "c": CALL_A}, salt=IDENTITY_SALT)
        with self.assertRaises(IdentityError) as ctx:
            read_identity_token(token, CALL_A)
        self.assertEqual(ctx.exception.reason, REASON_BAD_SIGNATURE)

    def test_payload_carries_no_identifying_detail(self):
        """Minimal payload: the consumer re-reads the User row instead."""
        payload = signing.loads(mint_identity_token(5, CALL_A), salt=IDENTITY_SALT)
        self.assertEqual(set(payload), {"u", "c"})


class LoadUserTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("voice-caller", password="pass")

    def test_resolves_an_active_user(self):
        self.assertEqual(resolve_user_sync(self.user.pk), self.user)

    def test_returns_none_for_a_deleted_pk(self):
        self.assertIsNone(resolve_user_sync(self.user.pk + 10_000))

    def test_returns_none_for_an_inactive_user(self):
        """A token minted before deactivation must not still act as that account."""
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        self.assertIsNone(resolve_user_sync(self.user.pk))

    async def test_async_load_user_resolves(self):
        user = await load_user(self.user.pk)
        self.assertEqual(user.pk, self.user.pk)

    async def test_async_load_user_returns_none_when_absent(self):
        self.assertIsNone(await load_user(self.user.pk + 10_000))
