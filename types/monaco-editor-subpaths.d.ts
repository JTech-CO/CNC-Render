declare module "monaco-editor/editor/editor.api.js" {
  export * from "monaco-editor";
}

declare module "monaco-editor/editor/editor.worker.js?worker" {
  const EditorWorker: {
    new (): Worker;
  };

  export default EditorWorker;
}
