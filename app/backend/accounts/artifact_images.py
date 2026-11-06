"""Validation for the optional custom image on an AccountArtifact.

Pillow is not a dependency, so images are identified by their leading bytes rather than
trusting the client's filename or Content-Type. SVG is deliberately not accepted: it can
carry script, and artifact uploads already block it for the same reason.
"""

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB

_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


def sniff_image_type(head: bytes):
    """Return the image mime type for the leading bytes, or None if unsupported."""
    for sig, mime in _SIGNATURES:
        if head.startswith(sig):
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def image_upload_error(upload):
    """Return a user-facing error string for an unacceptable image upload, else None."""
    if upload.size > MAX_IMAGE_BYTES:
        return "Image too large (max 5 MB)."
    head = upload.read(12)
    upload.seek(0)
    if sniff_image_type(head) is None:
        return "Image must be a PNG, JPEG, GIF or WebP file."
    return None


def delete_image_file(artifact):
    """Remove the stored image file (if any) and clear the field. Does not save."""
    if artifact.custom_image:
        artifact.custom_image.delete(save=False)
