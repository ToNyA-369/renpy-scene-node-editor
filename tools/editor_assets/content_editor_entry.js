import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js";
import { shikiToMonaco } from "@shikijs/monaco";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDarkDefault from "@shikijs/themes/github-dark-default";
import python from "@shikijs/langs/python";
import renpyGrammarSource from "./renpy-language/syntaxes/renpy.tmLanguage.json";
import renpyAtlGrammar from "./renpy-language/syntaxes/renpy.atl.tmLanguage.json";
import renpyPythonGrammar from "./renpy-language/syntaxes/renpy.python.tmLanguage.json";
import renpyScreenGrammar from "./renpy-language/syntaxes/renpy.screen.tmLanguage.json";
import renpyStyleGrammar from "./renpy-language/syntaxes/renpy.style.tmLanguage.json";
import renpyTestGrammar from "./renpy-language/syntaxes/renpy.test.tmLanguage.json";
import officialSnippetsSource from "./renpy-language/snippets/snippets.json";

const MODEL_CONTEXTS = new Map();
let completionRegistration = null;

const grammar = (source, name, aliases = []) => ({ ...source, name, aliases });

globalThis.MonacoEnvironment = {
  ...(globalThis.MonacoEnvironment || {}),
  getWorkerUrl() {
    return "/vendor/content_editor.worker.js";
  },
};

function suggestionKind(type) {
  if (type === "file") return monaco.languages.CompletionItemKind.File;
  if (type === "function") return monaco.languages.CompletionItemKind.Function;
  if (type === "reference") return monaco.languages.CompletionItemKind.Reference;
  return monaco.languages.CompletionItemKind.Snippet;
}

function completionItem(item, range, sortText) {
  return {
    label: item.label,
    detail: item.detail,
    documentation: item.documentation,
    insertText: item.insertText,
    insertTextRules: /\$\{?\d/.test(item.insertText)
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    kind: suggestionKind(item.type),
    range,
    sortText,
  };
}

async function initialize() {
  monaco.languages.register({ id: "renpy", aliases: ["Ren'Py", "rpy"], extensions: [".rpy"] });
  const highlighter = await createHighlighterCore({
    themes: [githubDarkDefault],
    langs: [
      python,
      grammar(renpyGrammarSource, "renpy", ["rpy"]),
      grammar(renpyAtlGrammar, "renpy-atl"),
      grammar(renpyPythonGrammar, "renpy-python"),
      grammar(renpyScreenGrammar, "renpy-screen"),
      grammar(renpyStyleGrammar, "renpy-style"),
      grammar(renpyTestGrammar, "renpy-test"),
    ],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  shikiToMonaco(highlighter, monaco, { tokenizeMaxLineLength: 20000, tokenizeTimeLimit: 250 });

  const support = globalThis.SceneContentEditorSupport;
  const snippets = support?.normalizeSnippets(officialSnippetsSource) || [];
  completionRegistration = monaco.languages.registerCompletionItemProvider("renpy", {
    triggerCharacters: [".", "\"", "'"],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const context = support?.completionContext(line) || "general";
      const project = MODEL_CONTEXTS.get(model.uri.toString()) || {};
      const projectItems = support?.projectSuggestions(context, project) || [];
      const candidates = context === "general" ? [...projectItems, ...snippets] : projectItems;
      return {
        suggestions: candidates.map((item, index) => completionItem(
          item,
          range,
          `${item.type === "function" || item.type === "reference" ? "0" : "1"}${String(index).padStart(4, "0")}`,
        )),
      };
    },
  });
}

const ready = initialize();

async function mount(options) {
  const host = options?.host;
  const textarea = options?.textarea;
  if (!host || !textarea) return null;
  await ready;
  if (!host.isConnected || !textarea.isConnected) return null;

  const path = String(options.path || `content-${Date.now()}`).replace(/[^\w./-]+/g, "-");
  const uri = monaco.Uri.parse(`inmemory://scene-node/${path}.rpy`);
  const model = monaco.editor.createModel(String(options.value ?? textarea.value ?? ""), "renpy", uri);
  MODEL_CONTEXTS.set(uri.toString(), options.project || {});
  const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const editor = monaco.editor.create(host, {
    model,
    theme: "github-dark-default",
    ariaLabel: options.ariaLabel || "Ren'Py code editor",
    automaticLayout: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono CJK TC", monospace',
    fontLigatures: false,
    fontSize: 14,
    lineHeight: 24,
    tabSize: 4,
    insertSpaces: true,
    detectIndentation: false,
    lineNumbers: "on",
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: true,
    showFoldingControls: "mouseover",
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    renderLineHighlight: "line",
    renderWhitespace: "selection",
    roundedSelection: true,
    scrollBeyondLastLine: false,
    wordWrap: "on",
    wrappingIndent: "indent",
    padding: { top: 18, bottom: 64 },
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    matchBrackets: "always",
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    autoIndent: "full",
    formatOnPaste: false,
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: true,
    snippetSuggestions: "top",
    suggestSelection: "first",
    stickyScroll: { enabled: false },
    smoothScrolling: !reducedMotion,
    cursorSmoothCaretAnimation: reducedMotion ? "off" : "on",
    contextmenu: true,
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
  });

  textarea.classList.add("code-editor-fallback-hidden");
  host.hidden = false;
  let syncingTextarea = false;
  const changeRegistration = editor.onDidChangeModelContent(() => {
    syncingTextarea = true;
    textarea.value = editor.getValue();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    syncingTextarea = false;
  });
  const syncFromTextarea = () => {
    if (!syncingTextarea && editor.getValue() !== textarea.value) {
      editor.setValue(textarea.value);
    }
  };
  textarea.addEventListener("input", syncFromTextarea);

  return {
    dispose() {
      changeRegistration.dispose();
      textarea.removeEventListener("input", syncFromTextarea);
      textarea.classList.remove("code-editor-fallback-hidden");
      MODEL_CONTEXTS.delete(uri.toString());
      editor.dispose();
      model.dispose();
    },
    focus() {
      editor.focus();
    },
    getValue() {
      return editor.getValue();
    },
  };
}

globalThis.SceneContentCodeEditor = Object.freeze({ mount });

globalThis.addEventListener?.("beforeunload", () => completionRegistration?.dispose(), { once: true });
