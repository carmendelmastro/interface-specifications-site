// Loads the two spec files, then swaps the payload / field tables when you
// click a button. Everything that never changes lives in index.html.

const FORMAT_LABELS = { hl7: "HL7 v2.x", xml: "XML", json: "JSON", fhir: "FHIR JSON" };

// The only three things that can change. Every click sets one, then re-renders.
const state = { type: "adt", format: "hl7", tab: "payload" };

let SPECS = {}; // filled in below: { adt: <adt.json>, medications: <med.json> }

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Field names contain characters like < and >, so escape before using innerHTML.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

initPageTabs();

// Header page tabs: Message Format vs Connection Guide. Kept independent of
// the spec-loading below so switching pages still works if that fetch fails.
function initPageTabs() {
  const buttons = $$("[data-page]");

  function show(page) {
    for (const b of buttons) b.setAttribute("aria-pressed", b.dataset.page === page);
    for (const panel of $$("[data-page-panel]")) panel.hidden = panel.dataset.pagePanel !== page;
  }

  for (const b of buttons) {
    b.addEventListener("click", () => {
      show(b.dataset.page);
      const q = new URLSearchParams(location.search);
      q.set("page", b.dataset.page);
      history.replaceState(null, "", `?${q}${location.hash}`);
    });
  }

  const initial = new URLSearchParams(location.search).get("page") === "connection" ? "connection" : "format";
  show(initial);
}

Promise.all([
  fetch("/data/adt.json").then((r) => r.json()),
  fetch("/data/med.json").then((r) => r.json()),
])
  .then(([adt, med]) => {
    SPECS = { adt: adt, medications: med };
    start();
  })
  .catch(() => {
    $("[data-payload]").textContent =
      "Could not load spec data. Are you running a local web server?";
    $("[data-view-payload]").hidden = false;
  });

function start() {
  readUrl();
  onClick("[data-type]", "type");
  onClick("[data-format]", "format");
  onClick("[data-tab]", "tab");
  bindCopy();
  render();
}

// Every button carries a data- attribute naming its value, e.g.
// <button data-format="xml">. Clicking it sets state.format = "xml".
function onClick(selector, key) {
  for (const el of $$(selector)) {
    el.addEventListener("click", () => {
      state[key] = el.dataset[key];
      render();
    });
  }
}

function render() {
  const spec = SPECS[state.type];
  const payload = spec.formats[state.format].payload;
  const label = FORMAT_LABELS[state.format];

  // Mark the chosen button in each group; CSS does the highlighting.
  markChosen("[data-type]", "type");
  markChosen("[data-format]", "format");
  markChosen("[data-tab]", "tab");

  // Show the hint that matches the chosen message type, hide the other.
  for (const p of $$("[data-hint]")) p.hidden = p.dataset.hint !== state.type;

  const badge = $("[data-badge]");
  badge.textContent = label;
  badge.dataset.format = state.format; // CSS colors the badge from this
  $("[data-panel-name]").textContent = spec.label;
  document.title = `${spec.label} — ${label}`;

  $("[data-view-payload]").hidden = state.tab !== "payload";
  $("[data-view-fields]").hidden = state.tab !== "fields";

  if (state.tab === "payload") {
    $("[data-payload-meta]").textContent = `${spec.payloadLabel} · ${label}`;
    $("[data-payload]").textContent = payload;
  } else {
    renderFields(spec.formats[state.format].sections);
  }

  writeUrl();
}

function markChosen(selector, key) {
  for (const el of $$(selector)) {
    el.setAttribute("aria-pressed", el.dataset[key] === state[key]);
  }
}

// The one part that genuinely needs to be generated: up to 40 rows per format,
// times 8 combinations. Builds one <table> per section.
function renderFields(sections) {
  $("[data-jump]").innerHTML = sections
    .map(
      (s, i) => `<button type="button" data-goto="${esc(s.id)}">
        <span class="jump-num">${i + 1}</span>${esc(s.title)}</button>`
    )
    .join("");

  $("[data-sections]").innerHTML = sections.map(sectionHtml).join("");

  for (const b of $$("[data-goto]")) {
    b.addEventListener("click", () => jumpTo(b.dataset.goto));
  }
}

function jumpTo(id) {
  const box = $("[data-sections]");
  const target = document.getElementById(`sec-${id}`);
  if (!target) return;
  const top =
    box.scrollTop + target.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.scrollTo({ top: top, behavior: "smooth" });
}

function sectionHtml(s) {
  return `<div class="section" id="sec-${esc(s.id)}">
    <div class="section-head">
      <div class="section-title">${esc(s.title)}</div>
      <div class="section-sub">${esc(s.subtitle)}</div>
    </div>
    <table class="fields">
      <thead>
        <tr>
          <th class="c-field">Field</th>
          <th class="c-desc">Description</th>
          <th class="c-type">Type</th>
          <th class="c-req">Req.</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>${s.fields.map(rowHtml).join("")}</tbody>
    </table>
  </div>`;
}

// Requirement codes come straight from the spec: R, R*, P, O. A blank cell in
// the PDF stays blank here rather than being guessed at.
const REQ_CLASS = { "R": "pill-req", "R*": "pill-cond", "P": "pill-pref", "O": "pill-opt" };

function rowHtml(f) {
  const cls = REQ_CLASS[f.req] || "pill-none";
  const pill = `<span class="pill ${cls}">${esc(f.req || "--")}</span>`;
  return `<tr>
    <td class="td-field">${esc(f.field)}</td>
    <td class="td-desc">${esc(f.description)}</td>
    <td class="td-type">${esc(f.type)}</td>
    <td class="td-req">${pill}</td>
    <td class="td-notes">${esc(f.notes)}</td>
  </tr>`;
}

function bindCopy() {
  const btn = $("[data-copy]");
  const label = $("[data-copy-label]");
  let timer;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(SPECS[state.type].formats[state.format].payload);
      btn.dataset.copied = "true";
      label.textContent = "Copied";
    } catch {
      label.textContent = "Press Ctrl+C";
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      delete btn.dataset.copied;
      label.textContent = "Copy";
    }, 1800);
  });
}

// Keep the address bar in step with state, so any view can be linked or bookmarked.
function readUrl() {
  const q = new URLSearchParams(location.search);
  if (SPECS[q.get("type")]) state.type = q.get("type");
  if (FORMAT_LABELS[q.get("format")]) state.format = q.get("format");
  if (q.get("tab") === "fields" || q.get("tab") === "payload") state.tab = q.get("tab");
}

function writeUrl() {
  const q = new URLSearchParams({ type: state.type, format: state.format, tab: state.tab });
  history.replaceState(null, "", `?${q}${location.hash}`);
}
