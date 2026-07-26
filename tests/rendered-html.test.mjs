import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const distRoot = fileURLToPath(new URL("../dist/", import.meta.url));
const removedStarterPaths = [
  new URL("../app/_sites-preview/", import.meta.url),
  new URL("../app/chatgpt-auth.ts", import.meta.url),
  new URL("../public/favicon.svg", import.meta.url),
];

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(path) : [path];
    }),
  );

  return files.flat();
}

test("server-renders the CNC Render M0 foundation page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*\blang="ko"/i);
  assert.match(html, /<title>CNC Render \| M0 Foundation<\/title>/i);
  assert.match(html, /교육용 근사/);
  assert.match(html, /산업용 검증 도구나 실제 장비 제어기가 아닙니다/);
  assert.match(html, /서로 침범하지 않는 네 개의 경계/);
  assert.match(html, /@cnc-render\/ui/);
  assert.match(html, /@cnc-render\/simulation/);
  assert.match(html, /@cnc-render\/renderer/);
  assert.match(html, /@cnc-render\/storage/);
  assert.match(html, /수직형 머시닝 센터 개념도/);
  assert.match(html, /M1/);
  assert.match(html, /도메인 스키마 · 단위 · 계약/);
  assert.match(html, /시뮬레이션 실행 기능 없음/);

  assert.doesNotMatch(
    html,
    /codex-preview|Starter Project|Your site is taking shape|Building your site|react-loading-skeleton|favicon\.svg|fonts\.googleapis\.com/i,
  );
});

test("ships the light-only design policy in built CSS", async () => {
  const files = await collectFiles(distRoot);
  const cssFiles = files.filter((file) => extname(file) === ".css");
  assert.ok(cssFiles.length > 0, "the build must emit at least one CSS asset");

  const css = (
    await Promise.all(cssFiles.map((file) => readFile(file, "utf8")))
  ).join("\n");

  assert.match(css, /color-scheme:\s*light/i);
  assert.match(css, /--app-bg:\s*#f4f6f8/i);
  assert.match(css, /--surface-primary:\s*#fff(?:fff)?/i);
  assert.match(css, /--primary-600:\s*#2859c5/i);
  assert.match(css, /Pretendard Variable/i);
  assert.match(css, /JetBrains Mono/i);
  assert.match(css, /:focus-visible/i);
  assert.match(css, /forced-colors:\s*active/i);

  assert.doesNotMatch(
    css,
    /prefers-color-scheme\s*:\s*dark|(?:linear|radial|conic)-gradient|backdrop-filter|@keyframes|\banimation(?:-[\w-]+)?\s*:|\bbox-shadow\s*:/i,
  );
});

test("removes disposable starter surfaces", async () => {
  await Promise.all(
    removedStarterPaths.map((path) => assert.rejects(access(path))),
  );
});
