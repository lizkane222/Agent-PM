"""The artifact preview endpoint and the user-supplied screenshot (preview image)."""
import io
import shutil
import tarfile
import tempfile
import zipfile
from unittest import mock

from django.core.cache import cache
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.artifact_preview import MAX_TABLE_ROWS, MAX_TEXT_BYTES, build_preview
from accounts.models import AccountArtifact
from accounts.tests.test_views import _make_account, _make_user

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
SVG = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
MEDIA = tempfile.mkdtemp(prefix="artifact-preview-tests-")

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def _xlsx(rows):
    shared = "".join(f"<si><t>{v}</t></si>" for v in ("Name", "Region", "Acme", "West"))
    sheet = (
        f'<worksheet xmlns="{NS_MAIN}"><sheetData>'
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>42</v></c></row>'
        + "".join(f'<row r="{i}"><c r="A{i}"><v>{i}</v></c></row>' for i in range(3, rows))
        + "</sheetData></worksheet>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("xl/workbook.xml", f'<workbook xmlns="{NS_MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Accounts" sheetId="1" r:id="rId1"/></sheets></workbook>')
        zf.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        zf.writestr("xl/sharedStrings.xml", f'<sst xmlns="{NS_MAIN}">{shared}</sst>')
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def _pptx():
    buf = io.BytesIO()
    a = "http://schemas.openxmlformats.org/drawingml/2006/main"
    with zipfile.ZipFile(buf, "w") as zf:
        for n, text in ((2, "Second slide"), (1, "Kickoff")):
            zf.writestr(f"ppt/slides/slide{n}.xml", f'<p:sld xmlns:p="x" xmlns:a="{a}"><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:sld>')
    return buf.getvalue()


def _docx():
    import docx
    d = docx.Document()
    d.add_paragraph("Quarterly plan")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text = "Owner"
    t.rows[0].cells[1].text = "Ada"
    out = io.BytesIO()
    d.save(out)
    return out.getvalue()


def _zip(n=3):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for i in range(n):
            zf.writestr(f"dir/file{i}.txt", "x")
    return buf.getvalue()


def _tar():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        info = tarfile.TarInfo("a/b.txt")
        info.size = 2
        tf.addfile(info, io.BytesIO(b"hi"))
    return buf.getvalue()


@override_settings(MEDIA_ROOT=MEDIA)
class ArtifactPreviewBase(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.owner = _make_user("pv_owner")
        self.mate = _make_user("pv_mate")
        self.stranger = _make_user("pv_stranger")
        self.acct = _make_account("Acme", admin_owner=self.owner)
        from team.models import TeamMember
        member = TeamMember.objects.create(full_name="Mate", email="mate@x.com", user=self.mate)
        self.acct.team_members.add(member)

    def make(self, name, data, mime="", uploaded_by=None):
        art = AccountArtifact.objects.create(
            account=self.acct, uploaded_by=uploaded_by or self.owner, artifact_type="file",
            name=name, mime_type=mime, file_size=len(data),
        )
        art.file.save(name, ContentFile(data), save=True)
        return art

    def preview(self, art, user=None):
        self.client.force_authenticate(user or self.owner)
        return self.client.get(f"/api/v1/accounts/artifacts/{art.id}/preview/")


class PreviewKindTests(ArtifactPreviewBase):
    def test_unauthenticated_is_401(self):
        art = self.make("a.txt", b"hello", "text/plain")
        self.assertEqual(self.client.get(f"/api/v1/accounts/artifacts/{art.id}/preview/").status_code, 401)

    def test_text(self):
        data = self.preview(self.make("notes.txt", b"hello\nworld", "text/plain")).data
        self.assertEqual((data["kind"], data["format"], data["text"], data["truncated"]), ("text", "plain", "hello\nworld", False))

    def test_markdown_and_json_and_code_formats(self):
        self.assertEqual(self.preview(self.make("r.md", b"# Hi", "text/markdown")).data["format"], "markdown")
        self.assertEqual(self.preview(self.make("c.json", b"{}", "application/json")).data["format"], "json")
        self.assertEqual(self.preview(self.make("q.sql", b"select 1", "")).data["format"], "code")

    def test_text_is_cut_at_the_cap(self):
        data = self.preview(self.make("big.log", b"a" * (MAX_TEXT_BYTES + 10), "text/plain")).data
        self.assertTrue(data["truncated"])
        self.assertEqual(len(data["text"]), MAX_TEXT_BYTES)

    def test_binary_masquerading_as_text_is_unsupported(self):
        data = self.preview(self.make("x.txt", b"ab\x00\x01cd" * 10, "text/plain")).data
        self.assertEqual(data["kind"], "unsupported")

    def test_csv_is_a_table_capped_at_200_rows(self):
        rows = "\n".join(f"{i},v{i}" for i in range(MAX_TABLE_ROWS + 50))
        data = self.preview(self.make("t.csv", rows.encode(), "text/csv")).data
        self.assertEqual(data["kind"], "table")
        self.assertEqual(len(data["sheets"][0]["rows"]), MAX_TABLE_ROWS)
        self.assertTrue(data["truncated"])

    def test_html_is_sanitized_again(self):
        data = self.preview(self.make("p.html", b"<p onclick='x()'>Hi</p><script>alert(1)</script>", "text/html")).data
        self.assertEqual(data["kind"], "html")
        self.assertNotIn("script", data["html"].lower())
        self.assertNotIn("onclick", data["html"].lower())

    def test_docx_text_and_tables(self):
        data = self.preview(self.make("plan.docx", _docx(), "")).data
        self.assertEqual(data["kind"], "document")
        self.assertIn("Quarterly plan", data["text"])
        self.assertIn("Owner | Ada", data["text"])

    def test_xlsx_rows_resolve_shared_strings(self):
        data = self.preview(self.make("s.xlsx", _xlsx(5), "")).data
        self.assertEqual(data["kind"], "table")
        self.assertEqual(data["sheets"][0]["name"], "Accounts")
        self.assertEqual(data["sheets"][0]["rows"][:2], [["Name", "Region"], ["Acme", "West", "42"]])

    def test_pptx_slides_are_in_numeric_order(self):
        data = self.preview(self.make("d.pptx", _pptx(), "")).data
        self.assertEqual(data["kind"], "slides")
        self.assertEqual([s["lines"] for s in data["slides"]], [["Kickoff"], ["Second slide"]])

    def test_zip_and_tar_list_entries(self):
        z = self.preview(self.make("a.zip", _zip(3), "application/zip")).data
        self.assertEqual((z["kind"], [e["name"] for e in z["entries"]][:1]), ("archive", ["dir/file0.txt"]))
        t = self.preview(self.make("a.tar", _tar(), "application/x-tar")).data
        self.assertEqual([e["name"] for e in t["entries"]], ["a/b.txt"])

    def test_zip_entries_are_capped(self):
        data = self.preview(self.make("many.zip", _zip(520), "application/zip")).data
        self.assertEqual(len(data["entries"]), 500)
        self.assertTrue(data["truncated"])

    def test_images_pdf_and_media_are_left_to_the_browser(self):
        for name, mime in (("a.png", "image/png"), ("a.pdf", "application/pdf"), ("a.mp4", "video/mp4"), ("a.mp3", "audio/mpeg")):
            self.assertEqual(self.preview(self.make(name, b"x", mime)).data["kind"], "native")

    def test_unknown_binary_is_unsupported(self):
        self.assertEqual(self.preview(self.make("a.xyz", b"\x01\x02", "application/octet-stream")).data["kind"], "unsupported")
        self.assertEqual(self.preview(self.make("old.doc", b"\xd0\xcf\x11\xe0", "application/msword")).data["kind"], "unsupported")

    def test_link_artifact_is_unsupported(self):
        art = AccountArtifact.objects.create(account=self.acct, uploaded_by=self.owner, artifact_type="link", name="L", url="https://x.test")
        self.assertEqual(self.preview(art).data["kind"], "unsupported")


class PreviewLimitsAndSafetyTests(ArtifactPreviewBase):
    def test_too_large_is_refused_without_reading(self):
        art = self.make("huge.docx", _docx(), "")
        with mock.patch("accounts.artifact_preview.MAX_PREVIEW_FILE_BYTES", 10):
            data = self.preview(art).data
        self.assertEqual(data["kind"], "too_large")

    def test_corrupt_office_file_gives_a_fixed_message_without_exception_text(self):
        art = self.make("broken.docx", b"not a zip at all " * 5, "")
        resp = self.preview(art)
        self.assertEqual(resp.status_code, 200)
        self.assertIn(resp.data["kind"], ("unsupported", "error"))
        self.assertNotIn("Traceback", str(resp.data))
        self.assertNotIn("BadZipFile", str(resp.data))

    def test_unexpected_parser_failure_hides_the_exception(self):
        art = self.make("a.docx", _docx(), "")
        with mock.patch("accounts.artifact_preview._docx_preview", side_effect=RuntimeError("secret /srv/path")):
            data = self.preview(art).data
        self.assertEqual(data["kind"], "error")
        self.assertNotIn("secret", str(data))

    def test_xml_with_entities_is_refused(self):
        evil = _xlsx(3).replace(b"<sst", b"<sst")  # placeholder to keep bytes type
        buf = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(evil)) as src, zipfile.ZipFile(buf, "w") as out:
            for n in src.namelist():
                body = src.read(n)
                if n == "xl/sharedStrings.xml":
                    body = b'<!DOCTYPE x [<!ENTITY a "aaaa">]>' + body
                out.writestr(n, body)
        data = self.preview(self.make("evil.xlsx", buf.getvalue(), "")).data
        self.assertEqual(data["kind"], "unsupported")

    def test_missing_file_on_disk_is_reported_not_raised(self):
        art = self.make("gone.txt", b"hello", "text/plain")
        art.file.delete(save=False)
        art.file.name = "account_artifacts/nowhere/gone.txt"
        art.save()
        self.assertEqual(build_preview(art)["kind"], "unavailable")

    def test_a_slow_parse_times_out(self):
        art = self.make("t.csv", b"a,b\n1,2", "text/csv")
        with mock.patch("accounts.artifact_preview.BUDGET_SECONDS", -1):
            self.assertEqual(self.preview(art).data["kind"], "error")

    def test_team_member_sees_it_stranger_gets_404(self):
        art = self.make("n.txt", b"hi", "text/plain")
        self.assertEqual(self.preview(art, self.mate).status_code, 200)
        self.assertEqual(self.preview(art, self.stranger).status_code, 404)

    def test_unknown_id_is_404(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get("/api/v1/accounts/artifacts/99999/preview/").status_code, 404)


class PreviewImageTests(ArtifactPreviewBase):
    def url(self, art):
        return f"/api/v1/accounts/artifacts/{art.id}/preview-image/"

    def upload(self, art, user, data=PNG, name="shot.png", ctype="image/png"):
        self.client.force_authenticate(user)
        return self.client.post(self.url(art), {"image": SimpleUploadedFile(name, data, content_type=ctype)}, format="multipart")

    def test_unauthenticated_is_401(self):
        art = self.make("a.xyz", b"x")
        self.assertEqual(self.client.post(self.url(art), {}, format="multipart").status_code, 401)
        self.assertEqual(self.client.delete(self.url(art)).status_code, 401)

    def test_owner_sets_a_screenshot_and_it_appears_in_the_artifact(self):
        art = self.make("a.xyz", b"x")
        resp = self.upload(art, self.owner)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["preview_image_url"].endswith(".png"))
        art.refresh_from_db()
        self.assertTrue(art.preview_image)

    def test_stored_name_comes_from_the_sniffed_type_not_the_client(self):
        art = self.make("a.xyz", b"x")
        self.upload(art, self.owner, name="evil.html")
        art.refresh_from_db()
        self.assertRegex(art.preview_image.name, rf"preview-{art.pk}[^/]*\.png$")

    def test_svg_is_rejected_even_with_an_image_content_type(self):
        art = self.make("a.xyz", b"x")
        resp = self.upload(art, self.owner, SVG, "x.svg", "image/svg+xml")
        self.assertEqual(resp.status_code, 400)
        resp = self.upload(art, self.owner, SVG, "x.png", "image/png")
        self.assertEqual(resp.status_code, 400)

    def test_non_image_bytes_are_rejected(self):
        art = self.make("a.xyz", b"x")
        self.assertEqual(self.upload(art, self.owner, b"%PDF-1.4 hello", "x.png").status_code, 400)

    def test_over_ten_megabytes_is_rejected(self):
        art = self.make("a.xyz", b"x")
        big = PNG + b"\x00" * (10 * 1024 * 1024)
        self.assertEqual(self.upload(art, self.owner, big).status_code, 400)

    def test_missing_image_is_400(self):
        art = self.make("a.xyz", b"x")
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(self.url(art), {}, format="multipart").status_code, 400)

    def test_team_member_who_is_not_the_uploader_gets_403(self):
        art = self.make("a.xyz", b"x")
        self.assertEqual(self.upload(art, self.mate).status_code, 403)
        art.refresh_from_db()
        self.assertFalse(art.preview_image)

    def test_stranger_gets_404(self):
        art = self.make("a.xyz", b"x")
        self.assertEqual(self.upload(art, self.stranger).status_code, 404)
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.delete(self.url(art)).status_code, 404)

    def test_replacing_removes_the_old_file(self):
        art = self.make("a.xyz", b"x")
        self.upload(art, self.owner)
        art.refresh_from_db()
        first = art.preview_image.path
        self.upload(art, self.owner, PNG + b"1")
        art.refresh_from_db()
        import os
        self.assertFalse(os.path.exists(first) and first != art.preview_image.path)

    def test_delete_removes_it(self):
        art = self.make("a.xyz", b"x")
        self.upload(art, self.owner)
        self.client.force_authenticate(self.owner)
        resp = self.client.delete(self.url(art))
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data["preview_image_url"])
        art.refresh_from_db()
        self.assertFalse(art.preview_image)

    def test_url_is_read_only_through_the_normal_update(self):
        art = self.make("a.xyz", b"x")
        self.client.force_authenticate(self.owner)
        resp = self.client.patch(f"/api/v1/accounts/artifacts/{art.id}/", {"preview_image_url": "http://evil/x.png"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data["preview_image_url"])
