import * as esbuild from "esbuild";
import { chromium } from "playwright";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vivian-perf-"));
const baselineRoot = path.join(workspace, "baseline");
fs.mkdirSync(baselineRoot);
const baselineIndex = process.argv.indexOf("--baseline");
const baseline =
  baselineIndex >= 0 ? process.argv[baselineIndex + 1] : "879f51d";
const archive = execFileSync(
  "git",
  ["archive", baseline, "lib", "app/components/scene-background.tsx"],
  { cwd: repo, maxBuffer: 16 * 1024 * 1024 },
);
execFileSync("tar", ["-x", "-C", baselineRoot], { input: archive });

const fixtureSource = String.raw`import React, { useEffect, useState } from '/workspace/vivian/node_modules/react';
import { createRoot } from '/workspace/vivian/node_modules/react-dom/client';
import { useSceneLibrary } from 'fixture-library';
import { SceneBackground } from 'fixture-background';
import { createModelResources, inspectPackage } from 'fixture-models';
import { clearRenderCopies } from 'fixture-cache';
import { useConversationHistory } from 'fixture-history';
const presets=['/day.svg','/night.svg'];
const initialMessage={from:'vivian' as const,text:'pending'};
function HistoryFixture(){
 const history=useConversationHistory(initialMessage,'pending',false);
 useEffect(()=>{(window as any).historyProbe=history;if(history.ready && !(window as any).historyReadyMs)(window as any).historyReadyMs=performance.now()-(window as any).historyStart;},[history]);
 return <div id="history" data-ready={history.ready}/>;
}
function Fixture() {
 const library=useSceneLibrary(presets,'fixture');
 const preset='day';
 const scene=library.scenes.find(s=>s.id===library.preferences.activeSceneId);
 useEffect(()=>{(window as any).library=library;},[library]);
 return <><HistoryFixture/><SceneBackground source={scene?.imageUrl ?? ((library.preferences.preset ?? preset)==='night'?'/night.svg':'/day.svg')} preview={scene?.thumbnailUrl} timing={library.selectionTiming}/><button id="select" onClick={()=>{(window as any).clickAt=performance.now();void library.selectScene('night');}}>Scene</button><button id="cold" onClick={()=>{(window as any).coldClickAt=performance.now();void fetch('/fixture-release-cold');void library.selectScene('cold');}}>Cold</button></>;
}
(async()=>{
 const canvas=document.createElement('canvas');canvas.width=canvas.height=5000;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#945e87';ctx.fillRect(0,0,5000,5000);ctx.fillStyle='#87aacc';ctx.fillRect(0,0,2500,5000);
 const blob=await new Promise<Blob>(r=>canvas.toBlob(r as BlobCallback,'image/png'));
 canvas.width=canvas.height=1;
 const make=async(id:string)=>inspectPackage([{path:'model.model3.json',blob:new Blob([JSON.stringify({Version:3,FileReferences:{Moc:'m.moc3',Textures:['t.png']}})])},{path:'m.moc3',blob:new Blob(['fixture'])},{path:'t.png',blob}],id);
 const a=await make('a'),b=await make('b');
 (window as any).runCache=async()=>{
   await clearRenderCopies(); const values=[];
   for(const [label,pack] of [['a-cold',a],['a-warm',a],['b-cold',b],['a-return',a]] as const){const start=performance.now();const resources=await createModelResources(pack,pack.models[0],{maxDimension:1024,budgetBytes:16*1024*1024});values.push({label,ms:performance.now()-start});resources.dispose();}
   return values;
 };
 (window as any).fixtureReady=true;
 (window as any).historyStart=performance.now();
 createRoot(document.getElementById('root')!).render(<Fixture/>);
})();
`;
fs.writeFileSync(
  path.join(workspace, "fixture.tsx"),
  fixtureSource.replaceAll("/workspace/vivian", repo),
);
const sessions = [];
(async () => {
  const results = {};
  for (const version of ["before", "after"]) {
    const root = version === "before" ? baselineRoot : repo;
    await esbuild.build({
      entryPoints: [path.join(workspace, "fixture.tsx")],
      bundle: true,
      outfile: path.join(workspace, `${version}.js`),
      jsx: "automatic",
      tsconfig: path.join(repo, "tsconfig.json"),
      nodePaths: [path.join(repo, "node_modules")],
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "fixtures",
          setup(build) {
            build.onResolve({ filter: /^fixture-/ }, (args) => ({
              path:
                root +
                {
                  "fixture-library": "/lib/use-scene-library.ts",
                  "fixture-background": "/app/components/scene-background.tsx",
                  "fixture-models": "/lib/local-models.ts",
                  "fixture-cache": "/lib/model-render-cache.ts",
                  "fixture-history": "/lib/use-conversation-history.ts",
                }[args.path],
            }));
            build.onResolve({ filter: /^@\// }, (args) => ({
              path:
                root +
                "/" +
                args.path.slice(2) +
                (args.path.endsWith(".tsx") || args.path.endsWith(".ts")
                  ? ""
                  : ".ts"),
            }));
          },
        },
      ],
    });
    let coldReleased = false, pendingCold;
    let preferences = {
      autoScene: false,
      activeSceneId: "day",
      preset: null,
      revision: "1",
    };
    const scenes = ["day", "night", "cold"].map((id) => ({
      id,
      imageUrl: `/${id}.svg`,
      thumbnailUrl: id === "cold" ? "/cold-thumb.svg" : `/${id}.svg`,
      label: id,
    }));
    const server = http.createServer(async (req, res) => {
      if (req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          `<style>.scene-background{position:absolute;inset:50px 0 0;background-size:cover}.scene-entering{animation:fade .42s ease}@keyframes fade{from{opacity:0}to{opacity:1}}</style><div id="root"></div><script src="/bundle.js"></script>`,
        );
      } else if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(fs.readFileSync(path.join(workspace, `${version}.js`)));
      } else if (req.url.endsWith(".svg")) {
        const send = () => {
          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Cache-Control", "max-age=3600");
          res.end(
            `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${req.url.includes("day") ? "#cccdaa" : "#173378"}"/></svg>`,
          );
        };
        if (req.url === "/cold.svg") {
          if (coldReleased) setTimeout(send, 900); else pendingCold = send;
        } else send();
      } else if (req.url === "/fixture-release-cold") {
        coldReleased = true; if (pendingCold) setTimeout(pendingCold, 900); res.end("ok");
      } else if (
        req.url.startsWith("/api/conversations?") ||
        req.url === "/api/conversations"
      ) {
        setTimeout(() => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ conversations: [], nextOffset: null }));
        }, 600);
      } else if (req.url === "/api/scenes") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ scenes, preferences }));
      } else if (req.url === "/api/scenes/preferences") {
        let body = "";
        for await (const chunk of req) body += chunk;
        setTimeout(() => {
          preferences = { ...preferences, ...JSON.parse(body) };
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ preferences }));
        }, 600);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    sessions.push({ server, browser: null });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      executablePath:
        process.env.CHROMIUM_EXECUTABLE_PATH ||
        (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      headless: true,
      args: ["--no-sandbox"],
    });
    sessions.at(-1).browser = browser;
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.error("browser error", err));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(
      () => window.fixtureReady && window.library?.ready,
    );
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      window.visibleDone = new Promise((resolve) => {
        const watch = () => {
          const layers = [...document.querySelectorAll(".scene-background")];
          if (layers.at(-1)?.style.backgroundImage.includes("night.svg"))
            resolve(performance.now() - window.clickAt);
          else requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      });
    });
    await page.click("#select");
    const sceneMs = await page.evaluate(() => window.visibleDone);
    await page.evaluate(() => {
      window.coldDone = new Promise((resolve) => {
        const watch = () => {
          const layers = [...document.querySelectorAll(".scene-background")];
          if (
            /cold(?:-thumb)?\.svg/.test(
              layers.at(-1)?.style.backgroundImage || "",
            )
          )
            resolve(performance.now() - window.coldClickAt);
          else requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      });
    });
    await page.click("#cold");
    const coldSceneVisibleMs = await page.evaluate(() => window.coldDone);
    const cache = await page.evaluate(() => window.runCache());
    const timings = await page.evaluate(() =>
      performance
        .getEntriesByType("measure")
        .map(({ name, duration, detail }) => ({ name, duration, detail })),
    );
    await page.waitForFunction(() => window.historyReadyMs);
    const composerReadyMs = await page.evaluate(() => window.historyReadyMs);
    results[version] = {
      cachedSceneVisibleMs: sceneMs,
      coldSceneVisibleMs,
      composerReadyMs,
      cache,
      timings,
    };
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  assert.ok(results.after.cachedSceneVisibleMs < 100, "cached scene must appear within 100 ms");
  assert.ok(results.after.coldSceneVisibleMs < 100, "cold scene must show its preview within 100 ms");
  assert.ok(results.after.composerReadyMs < results.before.composerReadyMs / 2, "composer must become ready before the cloud history");
  const cache = Object.fromEntries(results.after.cache.map(entry => [entry.label, entry.ms]));
  assert.ok(cache["a-warm"] < cache["a-cold"] / 10);
  assert.ok(cache["a-return"] < cache["a-cold"] / 10);
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0)
    fs.writeFileSync(
      process.argv[outputIndex + 1],
      JSON.stringify(results, null, 2) + "\n",
    );
  console.log(JSON.stringify(results, null, 2));
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  for (const { browser, server } of sessions) {
    if (browser?.isConnected()) await browser.close();
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  fs.rmSync(workspace, { recursive: true, force: true });
});
