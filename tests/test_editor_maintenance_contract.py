import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_JS = (ROOT / "EDITOR" / "static" / "app.js").read_text(encoding="utf-8")
INDEX_HTML = (ROOT / "EDITOR" / "static" / "index.html").read_text(encoding="utf-8")
STYLES_CSS = (ROOT / "EDITOR" / "static" / "styles.css").read_text(encoding="utf-8")
TOKENS_CSS = (ROOT / "EDITOR" / "static" / "css" / "tokens.css").read_text(encoding="utf-8")


class EditorMaintenanceContractTests(unittest.TestCase):
    def test_autosave_coordinator_loads_before_editor_app(self):
        coordinator = INDEX_HTML.index('src="/js/core/autosave_coordinator.js"')
        application = INDEX_HTML.index('src="/app.js"')
        self.assertLess(coordinator, application)

    def test_all_frontend_modules_load_before_the_composition_root(self):
        application = INDEX_HTML.index('src="/app.js"')
        for module in (
            "/js/core/i18n.js",
            "/js/core/api_client.js",
            "/js/core/editor_settings.js",
            "/js/core/event_contract.js",
            "/js/core/state_rule_contract.js",
            "/js/core/autosave_coordinator.js",
            "/js/ui/choice_picker.js",
            "/js/ui/group_drag.js",
            "/js/ui/list_reorder.js",
            "/js/workspaces/event_editor.js",
            "/js/workspaces/event_focus_navigation.js",
            "/js/workspaces/graph_model.js",
            "/js/workspaces/graph_layout_client.js",
            "/js/workspaces/textbox_profiles.js",
            "/js/workspaces/content_editor_support.js",
            "/js/workspaces/state_editor.js",
            "/vendor/content_editor.js",
        ):
            with self.subTest(module=module):
                self.assertLess(INDEX_HTML.index(f'src="{module}"'), application)

    def test_composition_root_does_not_reimplement_extracted_modules(self):
        for implementation in (
            "async function api(",
            "function normalizeEditorSettings(",
            "function graphRelationships(",
            "function populateSelectMenu(",
            "function defaultStatCondition(",
            "function defaultStatEffect(",
            "function conditionRowsHtml(",
            "function effectRowsHtml(",
            "function readWeighted(",
        ):
            with self.subTest(implementation=implementation):
                self.assertNotIn(implementation, APP_JS)

    def test_content_picker_uses_shared_choice_picker_component(self):
        self.assertIn('<select name="contentWeightedId"', APP_JS)
        self.assertNotIn('class="content-choice-picker"', APP_JS)
        self.assertNotIn("data-content-picker-toggle", APP_JS)
        self.assertIn("const LAYOUT = Object.freeze({", (ROOT / "EDITOR" / "static" / "js" / "ui" / "choice_picker.js").read_text(encoding="utf-8"))

    def test_css_foundations_load_before_legacy_workspace_styles(self):
        tokens = INDEX_HTML.index('href="/css/tokens.css"')
        base = INDEX_HTML.index('href="/css/base.css"')
        legacy = INDEX_HTML.index('href="/styles.css"')
        self.assertLess(tokens, base)
        self.assertLess(base, legacy)
        self.assertLess(INDEX_HTML.index('href="/vendor/content_editor.css"'), legacy)
        self.assertIn("--canvas:", TOKENS_CSS)
        self.assertFalse(STYLES_CSS.lstrip().startswith(":root {"))

    def test_content_editor_preserves_textarea_autosave_contract(self):
        self.assertIn('id="contentEditor"', APP_JS)
        self.assertIn('textarea.dispatchEvent(new Event("input", { bubbles: true }))', (
            ROOT / "tools" / "editor_assets" / "content_editor_entry.js"
        ).read_text(encoding="utf-8"))
        self.assertIn("contentEditorController?.getValue()", APP_JS)

    def test_navigation_flushes_pending_autosave(self):
        tab_switch = re.search(
            r"async function requestTabSwitch\(tab, options = \{\}\) \{(?P<body>.*?)(?=\n\})",
            APP_JS,
            re.DOTALL,
        )
        self.assertIsNotNone(tab_switch)
        tab_switch_body = tab_switch.group("body")
        self.assertIn("if (isSwitchingTab && !await flushAutosave()) return false;", tab_switch_body)
        self.assertLess(tab_switch_body.index("await flushAutosave()"), tab_switch_body.index("await refreshGraphSnapshot()"))
        self.assertLess(tab_switch_body.index("switchTab(tab, { ...options, render: false })"), tab_switch_body.index("await refreshGraphSnapshot()"))
        self.assertLess(tab_switch_body.index("await refreshGraphSnapshot()"), tab_switch_body.index("renderGraphPanel()"))
        self.assertIn('const project = await api("/api/graph");', APP_JS)
        self.assertIn('if (state.activeTab === "graph") renderGraphPanel();', APP_JS)
        self.assertIn('if (isSwitchingTab && state.activeTab === "graph")', APP_JS)
        self.assertIn(
            'if (path !== state.selectedNodePath && !await flushAutosave()) return;',
            APP_JS,
        )
        self.assertIn(
            'if (name !== state.selectedContent && !await flushAutosave()) return;',
            APP_JS,
        )

    def test_destructive_actions_cancel_autosave_before_delete_request(self):
        for function_name in ("deleteNode", "deleteEvent", "deleteContent"):
            with self.subTest(function=function_name):
                match = re.search(
                    rf"async function {function_name}\(\) \{{(?P<body>.*?)(?=\n(?:async )?function )",
                    APP_JS,
                    re.DOTALL,
                )
                self.assertIsNotNone(match)
                body = match.group("body")
                self.assertLess(
                    body.index("await cancelAutosaveAndWait();"),
                    body.index('method: "DELETE"'),
                )

    def test_beforeunload_uses_coordinator_unsaved_state(self):
        self.assertIn("if (!autosaveCoordinator.hasUnsaved()) return;", APP_JS)


if __name__ == "__main__":
    unittest.main()
