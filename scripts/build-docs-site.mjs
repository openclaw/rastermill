#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsDir = path.join(root, "docs");
const repoBase = "https://github.com/openclaw/rastermill";
const siteBase = "https://rastermill.com";
const productName = "Rastermill";
const productTagline = "Portable image processing for Node agents";
const productDescription =
  "A small Node image pipeline with in-process Photon, native codec fallbacks, pixel-budget guards, and typed results for agent-facing media work.";

const navSections = [
  ["Start", ["README.md", "configuration.md"]],
  ["API", ["probe.md", "transparency.md", "encode.md", "encode-within-bytes.md"]],
  ["Runtime", ["backends.md", "error-handling.md"]],
];

const pages = navSections
  .flatMap(([, rels]) => rels)
  .map((rel) => {
    const source = path.join(docsDir, rel);
    const markdown = fs.readFileSync(source, "utf8");
    const title = firstHeading(markdown) ?? titleize(path.basename(rel, ".md"));
    return {
      rel,
      source,
      markdown,
      title,
      outRel: rel === "README.md" ? "index.html" : rel.replace(/\.md$/, ".html"),
    };
  });

const pageByRel = new Map(pages.map((page) => [page.rel, page]));
const orderedPages = navSections.flatMap(([, rels]) =>
  rels.map((rel) => pageByRel.get(rel)).filter(Boolean),
);

for (const page of pages) {
  const html = markdownToHtml(page.markdown, page.rel);
  const toc = tocFromHtml(html);
  const index = orderedPages.findIndex((candidate) => candidate.rel === page.rel);
  const prev = index > 0 ? orderedPages[index - 1] : null;
  const next = index >= 0 && index < orderedPages.length - 1 ? orderedPages[index + 1] : null;
  const sectionName = navSections.find(([, rels]) => rels.includes(page.rel))?.[0] ?? "Docs";
  fs.writeFileSync(
    path.join(docsDir, page.outRel),
    layout({ page, html, toc, prev, next, sectionName }),
    "utf8",
  );
}

fs.writeFileSync(path.join(docsDir, "favicon.svg"), faviconSvg(), "utf8");
fs.writeFileSync(path.join(docsDir, ".nojekyll"), "", "utf8");
fs.writeFileSync(path.join(docsDir, "llms.txt"), llmsTxt(), "utf8");
validateLinks();
console.log("built docs site: docs/");

function firstHeading(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function titleize(input) {
  return input.replaceAll("-", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function outPathForMarkdown(rel) {
  return rel === "README.md" ? "index.html" : rel.replace(/\.md$/, ".html");
}

function pageHref(targetRel, currentRel) {
  const targetOut = outPathForMarkdown(targetRel);
  const currentOut = outPathForMarkdown(currentRel);
  return path.posix.relative(path.posix.dirname(currentOut), targetOut) || path.posix.basename(targetOut);
}

function markdownToHtml(markdown, currentRel) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = null;
  let listItemParts = null;
  let fence = null;
  let blockquote = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join(" "), currentRel)}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    flushListItem();
    html.push(`</${list}>`);
    list = null;
  };
  const flushListItem = () => {
    if (!listItemParts) return;
    html.push(`<li>${inline(listItemParts.join(" "), currentRel)}</li>`);
    listItemParts = null;
  };
  const flushBlockquote = () => {
    if (!blockquote.length) return;
    html.push(`<blockquote>${markdownToHtml(blockquote.join("\n"), currentRel)}</blockquote>`);
    blockquote = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^```([\w+-]+)?\s*$/);
    if (fenceMatch) {
      flushParagraph();
      closeList();
      flushBlockquote();
      if (fence) {
        html.push(
          `<pre><code class="language-${escapeAttr(fence.lang)}">${highlightCode(fence.lines.join("\n"), fence.lang)}</code></pre>`,
        );
        fence = null;
      } else {
        fence = { lang: fenceMatch[1] ?? "text", lines: [] };
      }
      continue;
    }
    if (fence) {
      fence.lines.push(line);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      closeList();
      blockquote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushBlockquote();
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    if (list && listItemParts && /^\s{2,}\S/.test(line)) {
      listItemParts.push(line.trim());
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slug(text);
      const body = inline(text, currentRel);
      html.push(
        level === 1
          ? `<h1 id="${id}">${body}</h1>`
          : `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-label="Anchor link">#</a>${body}</h${level}>`,
      );
      continue;
    }
    if (line.trimStart().startsWith("|") && isDivider(lines[index + 1] ?? "")) {
      flushParagraph();
      closeList();
      const header = splitRow(line);
      index += 1;
      const rows = [];
      while (index + 1 < lines.length && lines[index + 1].trimStart().startsWith("|")) {
        index += 1;
        rows.push(splitRow(lines[index]));
      }
      html.push(
        `<div class="table-wrap"><table><thead><tr>${header.map((cell) => `<th>${inline(cell, currentRel)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell, currentRel)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const bullet = line.match(/^\s*-\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list && list !== tag) closeList();
      if (!list) {
        list = tag;
        html.push(`<${tag}>`);
      }
      flushListItem();
      listItemParts = [(bullet ?? numbered)[1]];
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  flushBlockquote();
  return html.join("\n");
}

function splitRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  const cells = [];
  let cell = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function isDivider(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function inline(text, currentRel) {
  const stash = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    stash.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${stash.length - 1}\u0000`;
  });
  out = escapeHtml(out)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${escapeAttr(rewriteHref(href, currentRel))}">${label}</a>`)
    .replace(/&lt;(https?:\/\/[^\s<>]+)&gt;/g, '<a href="$1">$1</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)]);
}

function rewriteHref(href, currentRel) {
  if (/^(https?:|mailto:|tel:|#)/.test(href)) return href;
  const [raw, hash = ""] = href.split("#");
  if (!raw) return hash ? `#${hash}` : "";
  if (raw.endsWith(".md")) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(currentRel), raw));
    const rewritten = pageHref(target, currentRel);
    return `${rewritten}${hash ? `#${hash}` : ""}`;
  }
  return href;
}

function tocFromHtml(html) {
  const items = [];
  const matcher = /<h([23]) id="([^"]+)">([\s\S]*?)<\/h[23]>/g;
  let match;
  while ((match = matcher.exec(html))) {
    items.push({
      level: Number(match[1]),
      id: match[2],
      text: match[3].replace(/<a class="anchor"[^>]*>.*?<\/a>/, "").replace(/<[^>]+>/g, "").trim(),
    });
  }
  if (items.length < 2) return "";
  return `<nav class="toc" aria-label="On this page"><h2>On this page</h2>${items
    .map((item) => `<a class="toc-l${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>`)
    .join("")}</nav>`;
}

function layout({ page, html, toc, prev, next, sectionName }) {
  const home = page.rel === "README.md";
  const title = home ? `${productName} — ${productTagline}` : `${stripBackticks(page.title)} — ${productName}`;
  const description = home ? productDescription : `${stripBackticks(page.title)} documentation for Rastermill.`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="canonical" href="${canonicalUrl(page)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Rastermill">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${canonicalUrl(page)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeAttr(title)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script>${preThemeScript()}</script>
  <style>${css()}</style>
</head>
<body${home ? ' class="home"' : ""}>
  <button class="nav-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false">
    <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
  </button>
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-head">
        <a class="brand" href="./" aria-label="Rastermill docs home">
          <span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
          <span><strong>Rastermill</strong><small>Image pipeline docs</small></span>
        </a>
        ${themeToggleHtml()}
      </div>
      <label class="search"><span>Search</span><input id="doc-search" type="search" placeholder="encode, webp, pixels"></label>
      <nav>${navHtml(page)}</nav>
    </aside>
    <main>
      ${home ? homeHero() : standardHero(page, sectionName)}
      <div class="doc-grid${home ? " doc-grid-home" : ""}">
        <article class="${home ? "doc doc-home" : "doc"}">${html}${home ? "" : pageNavHtml(prev, next, page)}</article>${home ? "" : `\n        ${toc}`}
      </div>
    </main>
  </div>
  <script>${js()}</script>
</body>
</html>`;
}

function homeHero() {
  return `<header class="home-hero">
        <p class="eyebrow">Photon · Native Codecs · Pixel Budgets</p>
        <h1>${escapeHtml(productTagline)}</h1>
        <p class="lede">${escapeHtml(productDescription)}</p>
        <div class="home-cta">
          <a class="btn btn-primary" href="encode.html">Read the API</a>
          <a class="btn btn-ghost" href="${repoBase}" rel="noopener">GitHub</a>
          <div class="home-install" aria-label="Install with npm">
            <span class="prompt" aria-hidden="true">$</span>
            <code>npm install rastermill</code>
          </div>
        </div>
        <div class="home-services" aria-label="Supported surfaces">
          <span>JPEG</span><span>PNG</span><span>WebP</span><span>HEIC</span><span>AVIF</span><span>Photon</span><span>sips</span><span>ImageMagick</span><span>ffmpeg</span>
        </div>
      </header>`;
}

function standardHero(page, sectionName) {
  return `<header class="hero">
        <div class="hero-text">
          <p class="eyebrow">${escapeHtml(sectionName)}</p>
          <h1>${escapeHtml(stripBackticks(page.title))}</h1>
        </div>
        <div class="hero-meta">
          <a class="repo" href="${repoBase}" rel="noopener">GitHub</a>
          <a class="edit" href="${repoBase}/edit/main/docs/${page.rel}" rel="noopener">Edit page</a>
        </div>
      </header>`;
}

function navHtml(currentPage) {
  return navSections
    .map(([section, rels]) => `<section><h2>${escapeHtml(section)}</h2>${rels
      .map((rel) => {
        const page = pageByRel.get(rel);
        const active = page?.rel === currentPage.rel ? " active" : "";
        return `<a class="nav-link${active}" href="${pageHref(rel, currentPage.rel)}">${escapeHtml(navTitle(page))}</a>`;
      })
      .join("")}</section>`)
    .join("");
}

function navTitle(page) {
  if (!page) return "";
  if (page.rel === "README.md") return "Overview";
  return stripBackticks(page.title).replace(/^encodeWithinBytes$/, "encodeWithinBytes");
}

function pageNavHtml(prev, next, current) {
  if (!prev && !next) return "";
  const cell = (page, dir) =>
    page
      ? `<a class="page-nav-${dir}" href="${pageHref(page.rel, current.rel)}"><small>${dir === "prev" ? "Previous" : "Next"}</small><span>${escapeHtml(navTitle(page))}</span></a>`
      : "";
  return `<nav class="page-nav" aria-label="Pager">${cell(prev, "prev")}${cell(next, "next")}</nav>`;
}

function canonicalUrl(page) {
  return page.outRel === "index.html" ? `${siteBase}/` : `${siteBase}/${page.outRel}`;
}

function llmsTxt() {
  return `${[
    "# Rastermill",
    "",
    productDescription,
    "",
    "Canonical documentation:",
    ...orderedPages.map((page) => `- ${navTitle(page)}: ${canonicalUrl(page)}`),
    "",
    "Install:",
    "- npm install rastermill",
    "",
    `Source: ${repoBase}`,
  ].join("\n")}\n`;
}

function css() {
  return `
:root{
  --ink:#151718;--text:#283033;--muted:#687174;--subtle:#9aa2a4;
  --bg:#fbfbf8;--paper:#ffffff;--line:#e2e0d7;--line-soft:#f1f0ea;
  --accent:#0d7f86;--accent-soft:rgba(13,127,134,.11);--accent-strong:#075d63;
  --grain:#d6b05f;--leaf:#3e8f58;--rose:#c5534d;--blue:#3b6ea8;
  --code-bg:#101820;--code-fg:#e7f0ee;--code-inline-fg:#152024;--code-border:#263641;
  --shadow-card:0 4px 14px rgba(21,23,24,.08);
  --hl-keyword:#7fb4ff;--hl-string:#a7d78d;--hl-number:#e9b871;--hl-comment:#7f8b91;--hl-flag:#d3b3ff;--hl-meta:#f28c8c;--hl-prompt:#7e8d93;
}
:root[data-theme="dark"]{
  --ink:#f5f4ed;--text:#d2d6d4;--muted:#8e999a;--subtle:#687273;
  --bg:#0d1112;--paper:#171d1f;--line:#283235;--line-soft:#20282a;
  --accent:#31c0bc;--accent-soft:rgba(49,192,188,.16);--accent-strong:#68d9d2;
  --code-bg:#080c0f;--code-fg:#e7f0ee;--code-inline-fg:#e7f0ee;--code-border:#1d292e;
  --shadow-card:0 4px 18px rgba(0,0,0,.44);
}
:root{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px;max-width:100%;overflow-x:hidden}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Atkinson Hyperlegible",ui-sans-serif,system-ui,sans-serif;line-height:1.65;overflow-x:hidden;-webkit-font-smoothing:antialiased;transition:background-color .18s,color .18s}
::selection{background:var(--accent);color:#fff}a{color:var(--accent);text-decoration:none;transition:color .12s}a:hover{text-decoration:underline;text-underline-offset:.2em}
.shell{display:grid;grid-template-columns:268px minmax(0,1fr);min-height:100vh}
.sidebar{position:sticky;top:0;height:100vh;overflow:auto;padding:24px 22px;background:var(--paper);border-right:1px solid var(--line);scrollbar-width:thin;scrollbar-color:var(--line) transparent;transition:background-color .18s,border-color .18s}
.sidebar-head{display:flex;align-items:center;gap:10px;margin-bottom:24px}.brand{display:flex;align-items:center;gap:11px;color:var(--ink);text-decoration:none;flex:1;min-width:0}.brand:hover{text-decoration:none}
.brand .mark{display:grid;grid-template-columns:repeat(3,8px);grid-template-rows:repeat(2,8px);gap:4px;flex:0 0 32px;transform:rotate(-8deg)}
.brand .mark i{display:block;border-radius:2px}.brand .mark i:nth-child(1){background:var(--accent)}.brand .mark i:nth-child(2){background:var(--grain)}.brand .mark i:nth-child(3){background:var(--rose)}.brand .mark i:nth-child(4){background:var(--blue)}.brand .mark i:nth-child(5){background:var(--leaf)}.brand .mark i:nth-child(6){background:var(--accent-strong)}
.brand strong{display:block;font-size:1.05rem;line-height:1.1;font-weight:700;letter-spacing:0;color:var(--ink)}.brand small{display:block;color:var(--muted);font-size:.74rem;margin-top:3px;font-weight:400}
.theme-toggle{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;border:1px solid var(--line);background:var(--paper);color:var(--muted);cursor:pointer;padding:0;transition:border-color .15s,color .15s,transform .12s}.theme-toggle:hover{border-color:var(--ink);color:var(--ink)}.theme-toggle:active{transform:scale(.94)}.theme-toggle svg{width:16px;height:16px;display:block}.theme-icon-sun{display:none}:root[data-theme="dark"] .theme-icon-sun{display:block}:root[data-theme="dark"] .theme-icon-moon{display:none}
.search{display:block;margin:0 0 22px}.search span,nav h2,.eyebrow,.toc h2,.page-nav small{color:var(--muted);font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0}.search span{display:block;margin-bottom:7px}.search input{width:100%;border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:9px 12px;font:inherit;font-size:.9rem;color:var(--text);outline:none;transition:border-color .15s,box-shadow .15s}.search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
nav section{margin:0 0 18px}nav h2{margin:0 0 6px}.nav-link{display:block;color:var(--text);text-decoration:none;border-radius:6px;padding:5px 10px;margin:1px 0;font-size:.9rem;line-height:1.4;transition:background .12s,color .12s}.nav-link:hover{background:var(--line-soft);color:var(--ink);text-decoration:none}.nav-link.active{background:var(--accent-soft);color:var(--accent);font-weight:700}
main{min-width:0;padding:32px clamp(20px,4.5vw,56px) 80px;max-width:1180px;margin:0 auto;width:100%}
.hero,.home-hero{border-bottom:1px solid var(--line)}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:22px;padding:8px 0 22px;margin-bottom:8px;flex-wrap:wrap}.hero-text{min-width:0;flex:1 1 320px}.eyebrow{margin:0 0 8px}.hero h1{font-size:2.25rem;line-height:1.1;margin:0;font-weight:700;color:var(--ink)}
.hero-meta{display:flex;gap:8px;flex-wrap:wrap}.repo,.edit,.btn-ghost{border:1px solid var(--line);color:var(--text);text-decoration:none;border-radius:7px;padding:6px 11px;font-weight:700;font-size:.83rem;background:var(--paper);transition:border-color .15s,color .15s}.repo:hover,.edit:hover,.btn-ghost:hover{border-color:var(--ink);color:var(--ink);text-decoration:none}.edit{color:var(--muted)}
.home-hero{position:relative;padding:14px 0 28px;margin-bottom:8px}.home-hero:after{content:"";position:absolute;right:0;top:24px;width:196px;height:196px;background:linear-gradient(135deg,var(--accent),var(--grain) 45%,var(--rose));opacity:.16;clip-path:polygon(12% 0,100% 16%,82% 96%,0 78%);pointer-events:none}.home-hero h1{font-size:3.25rem;line-height:1.04;margin:0 0 .35em;font-weight:700;color:var(--ink);max-width:11em}.home-hero .lede{font-size:1.18rem;line-height:1.55;color:var(--text);margin:0 0 1.2em;max-width:60ch}
.home-cta{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 18px}.home-cta .btn{display:inline-flex;align-items:center;border-radius:8px;padding:10px 16px;font-weight:700;font-size:.92rem;text-decoration:none;transition:background .15s,border-color .15s,color .15s}.home-cta .btn-primary{background:var(--accent);color:#fff;border:1px solid var(--accent)}.home-cta .btn-primary:hover{background:var(--accent-strong);border-color:var(--accent-strong);text-decoration:none}.home-cta .btn-ghost{padding:10px 16px}
.home-install{display:flex;align-items:center;gap:12px;background:var(--code-bg);color:var(--code-fg);border-radius:8px;padding:10px 10px 10px 16px;font:500 .9rem/1.2 "JetBrains Mono",ui-monospace,monospace;max-width:32em;border:1px solid var(--code-border)}.home-install .prompt{color:var(--hl-prompt);user-select:none}.home-install code{flex:1;background:transparent;border:0;color:var(--code-fg);font:inherit;padding:0;white-space:pre;overflow:hidden;text-overflow:ellipsis}.copy{background:rgba(255,255,255,.08);color:var(--code-fg);border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:5px 11px;font:700 .72rem/1 "Atkinson Hyperlegible",sans-serif;cursor:pointer}.copy.copied{background:var(--accent);border-color:var(--accent)}
.home-services{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 18px}.home-services span{display:inline-block;padding:3px 9px;border:1px solid var(--line);border-radius:999px;font-size:.78rem;color:var(--muted);background:var(--paper)}
.doc-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:48px;margin-top:24px;min-width:0;max-width:100%}.doc-grid-home{margin-top:8px}@media(min-width:1180px){.doc-grid{grid-template-columns:minmax(0,72ch) 200px;justify-content:start}.doc-grid-home{grid-template-columns:minmax(0,76ch);justify-content:start}}
.doc{min-width:0;max-width:72ch;width:100%;overflow-wrap:break-word}.doc-home{max-width:76ch}.doc h1{font-size:2.6rem;line-height:1.08;margin:0 0 .4em;font-weight:700;color:var(--ink)}body:not(.home) .doc>h1:first-child{display:none}.doc h2{font-size:1.45rem;line-height:1.2;margin:2em 0 .5em;font-weight:700;color:var(--ink);position:relative}.doc h3{font-size:1.1rem;margin:1.7em 0 .35em;position:relative;font-weight:700;color:var(--ink)}.doc h4{font-size:.98rem;margin:1.4em 0 .25em;color:var(--ink);position:relative;font-weight:700}.doc :is(h2,h3,h4) .anchor{position:absolute;left:-1.05em;top:0;color:var(--subtle);opacity:0;text-decoration:none;font-weight:400;padding-right:.3em}.doc :is(h2,h3,h4):hover .anchor{opacity:.7}.doc p{margin:0 0 1.05em}.doc ul,.doc ol{padding-left:1.3rem;margin:0 0 1.15em}.doc li{margin:.25em 0}.doc strong{font-weight:700;color:var(--ink)}
.doc code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.84em;background:var(--line-soft);border:1px solid var(--line);border-radius:5px;padding:.08em .35em;color:var(--code-inline-fg)}.doc pre{position:relative;overflow:auto;background:var(--code-bg);color:var(--code-fg);border-radius:8px;padding:14px 18px;margin:1.3em 0;font-size:.85em;line-height:1.6;scrollbar-width:thin;scrollbar-color:#334155 transparent;border:1px solid var(--code-border);max-width:100%;width:100%}.doc pre code{display:block;background:transparent;border:0;color:inherit;padding:0;font-size:1em;white-space:pre}.doc pre .copy{position:absolute;top:8px;right:8px;opacity:0}.doc pre:hover .copy,.doc pre .copy:focus{opacity:1}
.doc pre .hl-c{color:var(--hl-comment);font-style:italic}.doc pre .hl-s{color:var(--hl-string)}.doc pre .hl-n{color:var(--hl-number)}.doc pre .hl-k{color:var(--hl-keyword);font-weight:700}.doc pre .hl-f{color:var(--hl-flag)}.doc pre .hl-m{color:var(--hl-meta);font-weight:700}.doc pre .hl-p{color:var(--hl-prompt);user-select:none}.doc pre .hl-cmd{color:var(--hl-keyword);font-weight:700}
.doc blockquote{margin:1.4em 0;padding:10px 16px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 8px 8px 0}.table-wrap{max-width:100%;overflow-x:auto;margin:1.2em 0}.doc table{width:100%;border-collapse:collapse;font-size:.92em}.doc th,.doc td{border-bottom:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top}.doc th{font-weight:700;color:var(--ink);background:var(--line-soft)}
.toc{position:sticky;top:24px;align-self:start;font-size:.84rem;padding-left:14px;border-left:1px solid var(--line);max-height:calc(100vh - 48px);overflow:auto}.toc h2{margin:0 0 10px}.toc a{display:block;color:var(--muted);text-decoration:none;padding:4px 0 4px 10px;line-height:1.35;border-left:2px solid transparent;margin-left:-12px}.toc a:hover{color:var(--ink);text-decoration:none}.toc a.active{color:var(--accent);border-left-color:var(--accent);font-weight:700}.toc-l3{padding-left:22px!important;font-size:.94em}@media(max-width:1179px){.toc{display:none}}
.page-nav{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:48px;border-top:1px solid var(--line);padding-top:20px}.page-nav>a{display:block;border:1px solid var(--line);background:var(--paper);border-radius:9px;padding:13px 16px;text-decoration:none;color:var(--text)}.page-nav>a:hover{border-color:var(--accent);text-decoration:none}.page-nav small{display:block;margin-bottom:5px}.page-nav span{display:block;font-weight:700;line-height:1.3;color:var(--ink)}.page-nav-next{text-align:right;grid-column:2}
.nav-toggle{display:none;position:fixed;top:14px;right:14px;z-index:20;width:40px;height:40px;border-radius:9px;background:var(--paper);border:1px solid var(--line);color:var(--ink);cursor:pointer;padding:10px 9px;flex-direction:column;justify-content:space-between;box-shadow:var(--shadow-card)}.nav-toggle span{display:block;width:100%;height:2px;background:currentColor;border-radius:2px;transition:transform .2s,opacity .2s}.nav-toggle[aria-expanded="true"] span:nth-child(1){transform:translateY(8px) rotate(45deg)}.nav-toggle[aria-expanded="true"] span:nth-child(2){opacity:0}.nav-toggle[aria-expanded="true"] span:nth-child(3){transform:translateY(-8px) rotate(-45deg)}
@media(max-width:900px){.shell{display:block}.sidebar{position:fixed;inset:0 30% 0 0;max-width:320px;height:100vh;z-index:15;transform:translateX(-100%);transition:transform .25s ease;box-shadow:0 18px 40px rgba(0,0,0,.18);pointer-events:none}.sidebar.open{transform:translateX(0);pointer-events:auto}.nav-toggle{display:flex;z-index:30}main{padding:64px 18px 56px}.hero h1{font-size:1.8rem}.home-hero h1{font-size:2.45rem}.doc h1{font-size:2.1rem}.hero-meta{width:100%;justify-content:flex-start}.doc-grid{margin-top:18px;gap:24px}.doc :is(h2,h3,h4) .anchor{display:none}}
@media(max-width:520px){main{padding:60px 14px 48px}.home-hero:after{right:-44px;top:24px;width:132px;height:132px;opacity:.12}.home-hero h1{font-size:2.18rem}.home-hero .lede{font-size:1.04rem}.home-install{width:100%;min-width:0;flex-wrap:wrap}.home-install code{min-width:0}.doc pre{margin-left:-14px;margin-right:-14px;border-radius:0;border-left:0;border-right:0;width:calc(100% + 28px);max-width:calc(100% + 28px)}}
`;
}

function js() {
  return `
const themeRoot=document.documentElement;
function applyTheme(mode){themeRoot.dataset.theme=mode;document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.setAttribute('aria-pressed',mode==='dark'?'true':'false'))}
function storedTheme(){try{return localStorage.getItem('theme')}catch(e){return null}}
function persistTheme(mode){try{localStorage.setItem('theme',mode)}catch(e){}}
applyTheme(themeRoot.dataset.theme==='dark'?'dark':'light');
document.querySelectorAll('[data-theme-toggle]').forEach(btn=>{btn.addEventListener('click',()=>{const next=themeRoot.dataset.theme==='dark'?'light':'dark';applyTheme(next);persistTheme(next)})});
const systemDark=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)');
if(systemDark){const f=e=>{if(!storedTheme())applyTheme(e.matches?'dark':'light')};systemDark.addEventListener?.('change',f)}
const sidebar=document.querySelector('.sidebar');const toggle=document.querySelector('.nav-toggle');const mobileNav=window.matchMedia('(max-width: 900px)');
function setSidebarOpen(open){if(!sidebar||!toggle)return;sidebar.classList.toggle('open',open);toggle.setAttribute('aria-expanded',open?'true':'false');if(mobileNav.matches){sidebar.inert=!open;sidebar.toggleAttribute('aria-hidden',!open)}else{sidebar.inert=false;sidebar.removeAttribute('aria-hidden')}}
setSidebarOpen(false);toggle?.addEventListener('click',()=>setSidebarOpen(!sidebar?.classList.contains('open')));document.addEventListener('click',e=>{if(!sidebar?.classList.contains('open'))return;if(sidebar.contains(e.target)||toggle?.contains(e.target))return;setSidebarOpen(false)});document.addEventListener('keydown',e=>{if(e.key==='Escape')setSidebarOpen(false)});mobileNav.addEventListener?.('change',()=>setSidebarOpen(sidebar?.classList.contains('open')??false));
const input=document.getElementById('doc-search');input?.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();document.querySelectorAll('nav section').forEach(sec=>{let any=false;sec.querySelectorAll('.nav-link').forEach(a=>{const m=!q||a.textContent.toLowerCase().includes(q);a.style.display=m?'block':'none';if(m)any=true});sec.style.display=any?'block':'none'})});
function attachCopy(target,getText){const btn=document.createElement('button');btn.type='button';btn.className='copy';btn.textContent='Copy';btn.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(getText());btn.textContent='Copied';btn.classList.add('copied');setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied')},1400)}catch{btn.textContent='Failed';setTimeout(()=>{btn.textContent='Copy'},1400)}});target.appendChild(btn)}
document.querySelectorAll('.doc pre').forEach(pre=>attachCopy(pre,()=>pre.querySelector('code')?.textContent??''));document.querySelectorAll('.home-install').forEach(el=>attachCopy(el,()=>el.querySelector('code')?.textContent??''));
const tocLinks=document.querySelectorAll('.toc a');if(tocLinks.length){const map=new Map();tocLinks.forEach(a=>{const id=a.getAttribute('href').slice(1);const el=document.getElementById(id);if(el)map.set(el,a)});const setActive=l=>{tocLinks.forEach(x=>x.classList.remove('active'));l.classList.add('active')};const obs=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);if(visible.length){const link=map.get(visible[0].target);if(link)setActive(link)}},{rootMargin:'-15% 0px -65% 0px',threshold:0});map.forEach((_,el)=>obs.observe(el))}
`;
}

function preThemeScript() {
  return `(function(){var s;try{s=localStorage.getItem('theme')}catch(e){}var d=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=s||(d?'dark':'light')})();`;
}

function themeToggleHtml() {
  return `<button class="theme-toggle" type="button" aria-label="Toggle dark mode" aria-pressed="false" data-theme-toggle>
    <svg class="theme-icon-moon" viewBox="0 0 20 20" aria-hidden="true"><path d="M14.6 12.1A6.5 6.5 0 0 1 7.4 2.7a6.5 6.5 0 1 0 7.2 9.4z" fill="currentColor"/></svg>
    <svg class="theme-icon-sun" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.4" fill="currentColor"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="10" y1="2" x2="10" y2="4"/><line x1="10" y1="16" x2="10" y2="18"/><line x1="2" y1="10" x2="4" y2="10"/><line x1="16" y1="10" x2="18" y2="10"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="14.4" y1="14.4" x2="15.8" y2="15.8"/><line x1="4.2" y1="15.8" x2="5.6" y2="14.4"/><line x1="14.4" y1="5.6" x2="15.8" y2="4.2"/></g></svg>
  </button>`;
}

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Rastermill">
<rect width="64" height="64" rx="12" fill="#101820"/>
<g transform="rotate(-8 32 32)">
<rect x="13" y="15" width="10" height="10" rx="2" fill="#31c0bc"/>
<rect x="27" y="15" width="10" height="10" rx="2" fill="#d6b05f"/>
<rect x="41" y="15" width="10" height="10" rx="2" fill="#c5534d"/>
<rect x="13" y="39" width="10" height="10" rx="2" fill="#3b6ea8"/>
<rect x="27" y="39" width="10" height="10" rx="2" fill="#3e8f58"/>
<rect x="41" y="39" width="10" height="10" rx="2" fill="#0d7f86"/>
</g></svg>`;
}

function highlightCode(code, lang) {
  const language = (lang ?? "text").toLowerCase();
  if (["bash", "sh", "shell", "zsh", "console"].includes(language)) return highlightShell(code);
  if (["ts", "typescript", "js", "javascript"].includes(language)) return highlightJs(code);
  if (language === "json") return highlightJson(code);
  return escapeHtml(code);
}

function highlightShell(code) {
  return code
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return `<span class="hl-c">${escapeHtml(line)}</span>`;
      return highlightShellLine(line);
    })
    .join("\n");
}

function highlightShellLine(line) {
  const stash = [];
  const add = (match, cls) => {
    stash.push(`<span class="${cls}">${escapeHtml(match)}</span>`);
    return stashPlaceholder(stash.length - 1);
  };
  let working = line.replace(/(?:'[^']*'|"[^"]*")/g, (match) => add(match, "hl-s"));
  working = working.replace(/(^|\s)(--?[A-Za-z][A-Za-z0-9-]*)/g, (_, lead, flag) => `${escapeHtml(lead)}${add(flag, "hl-f")}`);
  working = working.replace(/\b(npm|pnpm|node|rastermill|magick|gm|ffmpeg|sips|curl)\b/g, (match) => add(match, "hl-cmd"));
  working = working.replace(/\b(\d+(?:\.\d+)?)\b/g, (match) => add(match, "hl-n"));
  return replaceStash(escapeHtml(working), stash);
}

function highlightJs(code) {
  return withStash(code, [
    [/\/\/[^\n]*/g, "hl-c"],
    [/\/\*[\s\S]*?\*\//g, "hl-c"],
    [/`(?:\\.|[^`\\])*`/g, "hl-s"],
    [/"(?:\\.|[^"\\])*"/g, "hl-s"],
    [/'(?:\\.|[^'\\])*'/g, "hl-s"],
    [/\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|extends|new|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|type|interface|null|undefined|true|false)\b/g, "hl-k"],
    [/\b(\d+(?:\.\d+)?)\b/g, "hl-n"],
  ]);
}

function highlightJson(code) {
  return withStash(code, [
    [/"(?:\\.|[^"\\])*"\s*:/g, "hl-k"],
    [/"(?:\\.|[^"\\])*"/g, "hl-s"],
    [/\b(true|false|null)\b/g, "hl-m"],
    [/-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, "hl-n"],
  ]);
}

function withStash(code, patterns) {
  const stash = [];
  let working = code;
  for (const [matcher, cls] of patterns) {
    working = working.replace(matcher, (match) => {
      stash.push(`<span class="${cls}">${escapeHtml(match)}</span>`);
      return stashPlaceholder(stash.length - 1);
    });
  }
  return replaceStash(escapeHtml(working), stash);
}

function stashPlaceholder(index) {
  return String.fromCodePoint(0xe000 + index);
}

function replaceStash(value, stash) {
  let out = value;
  for (let index = 0; index < stash.length; index += 1) {
    out = out.replaceAll(stashPlaceholder(index), stash[index]);
  }
  return out;
}

function validateLinks() {
  const htmlFiles = fs.readdirSync(docsDir).filter((file) => file.endsWith(".html"));
  const failures = [];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(docsDir, file), "utf8");
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (/^(#|https?:|mailto:|tel:)/.test(href)) continue;
      const [rawPath, anchor = ""] = href.split("#");
      const target = rawPath ? path.join(docsDir, rawPath) : path.join(docsDir, file);
      if (!fs.existsSync(target)) {
        failures.push(`${file}: ${href} missing`);
        continue;
      }
      if (anchor && !fs.readFileSync(target, "utf8").includes(`id="${anchor}"`)) {
        failures.push(`${file}: ${href} missing anchor`);
      }
    }
  }
  if (failures.length) throw new Error(`broken docs links:\n${failures.join("\n")}`);
}

function slug(text) {
  return text.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stripBackticks(text) {
  return text.replace(/`/g, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}
