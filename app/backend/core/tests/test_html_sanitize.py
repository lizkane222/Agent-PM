"""
Tests for core.html_sanitize.

This is a security control, so the bulk of these are adversarial: each asserts a
specific injection shape does not survive. The permissive cases matter too — a
sanitizer that strips the formatting out of an exported report is useless even if
it is safe.
"""

from django.test import TestCase

from core.html_sanitize import is_html_filename, sanitize_html


class ScriptRemovalTests(TestCase):
    def test_script_element_and_its_body_are_removed(self):
        out = sanitize_html("<p>before</p><script>alert(1)</script><p>after</p>")
        self.assertNotIn("script", out.lower())
        self.assertNotIn("alert(1)", out)
        self.assertIn("before", out)
        self.assertIn("after", out)

    def test_nested_script_tags_leave_nothing_executable(self):
        """
        `<script>` content is CDATA, so the FIRST `</script>` closes the element —
        in this parser and in every browser alike. So `alert(2)` here is not a
        nested script body, it is document text that happens to look like code,
        and it is emitted as inert text with no enclosing tag. What must not
        survive is the script body itself and any tag that could re-arm it.
        """
        out = sanitize_html("<script><script>alert(1)</script>alert(2)</script><p>ok</p>")
        self.assertNotIn("alert(1)", out)
        self.assertNotIn("<script", out.lower())
        self.assertNotIn("</script", out.lower())
        self.assertIn("ok", out)

    def test_markup_after_a_closing_script_tag_is_still_sanitized(self):
        """The real risk in the CDATA-mode case: suppression must not stay stuck
        off, letting a following handler-bearing tag through unfiltered."""
        out = sanitize_html('<script>x</script><img src="/a.png" onerror="alert(1)">')
        self.assertNotIn("onerror", out.lower())
        self.assertNotIn("alert(1)", out)
        self.assertIn("<img", out)

    def test_uppercase_and_mixed_case_script_is_removed(self):
        out = sanitize_html("<SCRIPT>alert(1)</SCRIPT><ScRiPt>alert(2)</ScRiPt>")
        self.assertNotIn("alert", out)

    def test_noscript_and_template_bodies_are_removed(self):
        out = sanitize_html("<noscript><img src=x onerror=alert(1)></noscript>")
        self.assertNotIn("onerror", out)
        out = sanitize_html("<template><script>alert(1)</script></template>")
        self.assertNotIn("alert", out)


class EventHandlerTests(TestCase):
    def test_onerror_attribute_is_stripped_but_element_survives(self):
        out = sanitize_html('<img src="/media/a.png" onerror="alert(1)">')
        self.assertNotIn("onerror", out.lower())
        self.assertNotIn("alert", out)
        self.assertIn("<img", out)

    def test_every_on_prefixed_attribute_is_stripped(self):
        markup = (
            '<div onclick="a()" onmouseover="b()" onload="c()" onfocus="d()" '
            'ONBLUR="e()" onanimationstart="f()">text</div>'
        )
        out = sanitize_html(markup)
        for handler in ("onclick", "onmouseover", "onload", "onfocus", "onblur", "onanimationstart"):
            self.assertNotIn(handler, out.lower())
        self.assertIn("text", out)

    def test_srcdoc_is_stripped(self):
        out = sanitize_html('<div srcdoc="<script>alert(1)</script>">x</div>')
        self.assertNotIn("srcdoc", out.lower())


class UrlSchemeTests(TestCase):
    def test_javascript_href_is_dropped_and_the_link_text_survives(self):
        out = sanitize_html('<a href="javascript:alert(1)">click</a>')
        self.assertNotIn("javascript", out.lower())
        self.assertIn("click", out)

    def test_javascript_url_with_embedded_control_characters_is_dropped(self):
        # Browsers strip tabs/newlines/NULs before parsing the scheme, so
        # "java\tscript:" is live. A naive startswith check misses this.
        for variant in (
            "java\tscript:alert(1)",
            "java\nscript:alert(1)",
            "  javascript:alert(1)",
            "java\x00script:alert(1)",
            "JaVaScRiPt:alert(1)",
        ):
            out = sanitize_html(f'<a href="{variant}">x</a>')
            self.assertNotIn("alert", out, f"leaked for variant {variant!r}")

    def test_vbscript_and_file_schemes_are_dropped(self):
        self.assertNotIn("vbscript", sanitize_html('<a href="vbscript:msgbox(1)">x</a>').lower())
        self.assertNotIn("file:", sanitize_html('<a href="file:///etc/passwd">x</a>').lower())

    def test_data_text_html_is_dropped(self):
        out = sanitize_html('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>')
        self.assertNotIn("data:text/html", out.lower())

    def test_data_image_svg_is_dropped_because_svg_can_script(self):
        out = sanitize_html('<img src="data:image/svg+xml;base64,PHN2Zz4=">')
        self.assertNotIn("svg+xml", out.lower())

    def test_safe_schemes_and_relative_urls_survive(self):
        for url in (
            "https://example.com/report",
            "http://example.com",
            "mailto:a@b.com",
            "/media/account_artifacts/2026/09/x.png",
            "./sibling.html",
            "#section-2",
        ):
            out = sanitize_html(f'<a href="{url}">x</a>')
            self.assertIn(url, out, f"{url} should have survived")

    def test_data_image_png_survives(self):
        url = "data:image/png;base64,iVBORw0KGgo="
        self.assertIn(url, sanitize_html(f'<img src="{url}">'))

    def test_surviving_links_get_noopener(self):
        out = sanitize_html('<a href="https://example.com">x</a>')
        self.assertIn("noopener", out)


class EmbeddingTests(TestCase):
    def test_iframe_object_embed_are_removed(self):
        for tag in ("iframe", "object", "embed", "applet", "frame"):
            out = sanitize_html(f'<{tag} src="https://evil.test/x"></{tag}>')
            self.assertNotIn(tag, out.lower(), f"{tag} survived")

    def test_base_tag_is_removed(self):
        # <base href> rewrites every relative URL on the page.
        out = sanitize_html('<base href="https://evil.test/"><a href="/x">y</a>')
        self.assertNotIn("<base", out.lower())
        self.assertIn("y", out)

    def test_meta_refresh_is_removed(self):
        out = sanitize_html('<meta http-equiv="refresh" content="0;url=https://evil.test">')
        self.assertNotIn("http-equiv", out.lower())
        self.assertNotIn("evil.test", out)

    def test_link_stylesheet_is_removed(self):
        out = sanitize_html('<link rel="stylesheet" href="https://evil.test/x.css">')
        self.assertNotIn("<link", out.lower())

    def test_form_is_unwrapped_but_its_text_survives(self):
        out = sanitize_html('<form action="https://evil.test"><p>keep me</p></form>')
        self.assertNotIn("<form", out.lower())
        self.assertNotIn("evil.test", out)
        self.assertIn("keep me", out)

    def test_svg_foreignobject_is_dropped(self):
        # foreignObject re-opens arbitrary HTML inside an SVG subtree.
        out = sanitize_html("<svg><foreignObject><script>alert(1)</script></foreignObject></svg>")
        self.assertNotIn("alert", out)
        self.assertNotIn("foreignobject", out.lower())


class CssTests(TestCase):
    def test_style_attribute_with_javascript_url_is_dropped(self):
        out = sanitize_html('<div style="background:url(javascript:alert(1))">x</div>')
        self.assertNotIn("javascript", out.lower())
        self.assertIn("x", out)

    def test_style_attribute_with_ie_expression_is_dropped(self):
        out = sanitize_html('<div style="width:expression(alert(1))">x</div>')
        self.assertNotIn("expression", out.lower())

    def test_benign_style_attribute_survives(self):
        out = sanitize_html('<div style="color: #333; font-weight: bold">x</div>')
        self.assertIn("color: #333", out)


class CommentAndDeclarationTests(TestCase):
    def test_comments_are_dropped(self):
        out = sanitize_html("<p>a</p><!--[if IE]><script>alert(1)</script><![endif]--><p>b</p>")
        self.assertNotIn("alert", out)
        self.assertNotIn("<!--", out)

    def test_cdata_is_dropped(self):
        out = sanitize_html("<![CDATA[<script>alert(1)</script>]]><p>ok</p>")
        self.assertNotIn("alert", out)
        self.assertIn("ok", out)

    def test_processing_instruction_is_dropped(self):
        out = sanitize_html('<?xml-stylesheet href="evil.xsl"?><p>ok</p>')
        self.assertNotIn("xml-stylesheet", out)
        self.assertIn("ok", out)

    def test_doctype_survives(self):
        self.assertIn("<!DOCTYPE html>", sanitize_html("<!DOCTYPE html><p>x</p>"))

    def test_escaped_markup_is_not_decoded_into_live_markup(self):
        # &lt;script&gt; in the source must stay inert text, not become a tag.
        out = sanitize_html("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")
        self.assertNotIn("<script", out.lower())
        self.assertIn("&lt;", out)


class ContentPreservationTests(TestCase):
    def test_a_typical_exported_report_survives_intact(self):
        markup = """<!DOCTYPE html>
<html><head><title>Q3 Report</title>
<style>body { font-family: sans-serif } .kpi { color: #0a0 }</style></head>
<body>
  <h1>Q3 Summary</h1>
  <p>Revenue grew <strong>14%</strong> against a <em>flat</em> pipeline.</p>
  <table><thead><tr><th>Metric</th><th>Value</th></tr></thead>
  <tbody><tr><td class="kpi">MRR</td><td>$1.2M</td></tr></tbody></table>
  <ul><li>Expand Berxi</li><li>Renew JPMC</li></ul>
  <a href="https://app.segment.com/berxi/overview">Workspace</a>
</body></html>"""
        out = sanitize_html(markup)
        for fragment in (
            "Q3 Summary", "Revenue grew", "<strong>", "<table>", "<th>Metric</th>",
            "$1.2M", "Expand Berxi", "Renew JPMC", "app.segment.com/berxi/overview",
            "font-family: sans-serif",
        ):
            self.assertIn(fragment, out, f"lost {fragment!r}")

    def test_inline_svg_chart_survives(self):
        markup = '<svg viewBox="0 0 100 50"><path d="M0 50 L50 10" stroke="#e22"/></svg>'
        out = sanitize_html(markup)
        self.assertIn("<svg", out)
        self.assertIn('d="M0 50 L50 10"', out)
        self.assertIn('stroke="#e22"', out)

    def test_empty_and_none_input_are_safe(self):
        self.assertEqual(sanitize_html(""), "")
        self.assertEqual(sanitize_html(None), "")

    def test_unknown_tag_is_dropped_but_its_text_survives(self):
        out = sanitize_html("<madeuptag>text</madeuptag>")
        self.assertNotIn("madeuptag", out)
        self.assertIn("text", out)

    def test_sanitizing_twice_is_stable(self):
        markup = '<p>a</p><script>alert(1)</script><a href="https://x.test">l</a>'
        once = sanitize_html(markup)
        self.assertEqual(once, sanitize_html(once))


class IsHtmlFilenameTests(TestCase):
    def test_recognises_html_extensions(self):
        for name in ("report.html", "REPORT.HTM", "a.xhtml", "path/to/x.html"):
            self.assertTrue(is_html_filename(name), name)

    def test_rejects_non_html(self):
        for name in ("report.pdf", "x.png", "notes.txt", "archive.zip", "noextension", ""):
            self.assertFalse(is_html_filename(name), name)

    def test_does_not_match_a_name_merely_containing_html(self):
        self.assertFalse(is_html_filename("html_notes.txt"))
        self.assertFalse(is_html_filename("about-html.pdf"))
