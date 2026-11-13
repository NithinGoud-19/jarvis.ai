/**
 * The form reader: a small script that runs INSIDE the job page (in the browser, not in Node).
 *
 * 📘 LESSON: Two worlds — Node and the page
 * Playwright code runs in Node. The page's DOM (document, inputs, labels) only exists in the
 * browser. page.evaluate(script) sends a script to the browser, runs it there, and sends the
 * RESULT back as plain JSON. So the script can't use our Node variables — and it must be plain
 * JavaScript (that's why it is a string here: our TypeScript compiler can't add helpers to it).
 *
 * What it does:
 *   1. Finds every visible input / textarea / select (+ simple Yes/No buttons, used by Ashby).
 *   2. Works out the QUESTION for each one (its <label>, aria-label, Lever's ".application-label" …).
 *   3. Groups radio buttons / checkboxes into one question with options.
 *   4. Tags each element with data-jarvis="N" so Node can find it again later.
 */

export type FieldOption = { ref: string; label: string; value?: string };

export type FormField = {
  ref: string; // data-jarvis value (for groups: the group id; options have their own refs)
  /**
   * listbox     = Workday dropdown: a <button> that opens a list (options are read by opening it)
   * multiselect = Workday search box ("Field of Study", phone code): type → pick from results
   */
  kind: "text" | "textarea" | "select" | "combobox" | "file" | "radio" | "checkbox" | "buttons" | "listbox" | "multiselect";
  question: string;
  required: boolean;
  inputType?: string; // "email", "tel", "number" …
  idHint?: string; // element id + name + Workday automation id — helps when labels are odd
  autocomplete?: boolean; // typing shows a suggestion list (Lever location, Greenhouse dropdowns)
  options?: FieldOption[];
  current?: string; // value already in the field (Workday remembers your last application)
};

/**
 * 📘 Called as (READ_FORM_FN)(start) → { fields, next }.
 * Refs are numbers handed out by NODE (start = next free number). Elements that already have a
 * ref keep it — so the form can be re-read after every choice (Workday adds/changes fields when
 * you pick a country or answer "Yes") without breaking refs JARVIS is still watching.
 */
export const READ_FORM_FN = String.raw`(start) => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/[*✱]/g, "").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };
  // Text of a label WITHOUT the inputs, buttons and error messages inside it.
  const textOf = (el) => {
    if (!el) return "";
    const c = el.cloneNode(true);
    c.querySelectorAll("input,select,textarea,button,ul,svg,[role=listbox],[aria-hidden=true],[class*=error],[class*=loading],[class*=dropdown]").forEach((n) => n.remove());
    return clean(c.textContent);
  };
  const leverLabel = (el) => {
    const q = el.closest(".application-question");
    const l = q && q.querySelector(".application-label");
    return l ? textOf(l) : "";
  };
  // Workday wraps every field in data-automation-id="formField-…"; questionnaire questions use a <legend>.
  const workdayLabel = (el) => {
    const ff = el.closest('[data-automation-id^="formField-"]');
    if (!ff) return "";
    const lg = el.closest("fieldset") && el.closest("fieldset").querySelector("legend");
    if (lg && textOf(lg)) return textOf(lg);
    const l = ff.querySelector("label");
    return l ? textOf(l) : "";
  };
  const labelFor = (el) => {
    const lever = leverLabel(el);
    if (lever) return lever;
    const wd = workdayLabel(el);
    if (wd) return wd;
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && textOf(l)) return textOf(l);
    }
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = clean(by.split(" ").map((id) => textOf(document.getElementById(id))).join(" "));
      if (t) return t;
    }
    const aria = el.getAttribute("aria-label");
    if (aria && !/^search$/i.test(aria)) return clean(aria);
    const wrap = el.closest("label");
    if (wrap && textOf(wrap)) return textOf(wrap);
    // Ashby: the label's "for" points nowhere, but label + input share a field container.
    const box = el.closest("[data-field-path]") || el.parentElement && el.parentElement.parentElement;
    const labels = box ? box.querySelectorAll("label") : [];
    if (labels.length === 1 && textOf(labels[0])) return textOf(labels[0]);
    return clean(el.placeholder || "");
  };
  const isOptionLabel = (c) => {
    if (c.tagName !== "LABEL" || !c.htmlFor) return false;
    const t = document.getElementById(c.htmlFor);
    return !!t && /radio|checkbox/.test(t.type || "");
  };
  // The question of a radio/checkbox/button GROUP: <legend>, Lever label, or the nearest
  // label-ish element above it that is not itself an option.
  const groupQuestion = (el) => {
    const fs = el.closest("fieldset");
    const lg = fs && fs.querySelector("legend");
    if (lg && textOf(lg)) return textOf(lg);
    const lever = leverLabel(el);
    if (lever) return lever;
    let node = el.parentElement;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      for (const c of node.querySelectorAll("label, legend, [class*=label], [class*=question], [class*=title]")) {
        if (c.contains(el) || isOptionLabel(c) || c.querySelector("input,button,select,textarea")) continue;
        const t = textOf(c);
        if (t.length > 2) return t;
      }
    }
    return "";
  };
  const optionLabel = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && textOf(l)) return textOf(l);
    }
    const wrap = el.closest("label");
    if (wrap && textOf(wrap)) return textOf(wrap);
    return clean(el.value);
  };

  let n = start;
  const mark = (el) => {
    const old = el.getAttribute("data-jarvis");
    if (old) return old;
    const id = String(n++);
    el.setAttribute("data-jarvis", id);
    return id;
  };
  const aid = (el) => el.getAttribute("data-automation-id") || "";
  const out = [];
  const groups = new Map();

  for (const el of document.querySelectorAll("input, textarea, select")) {
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "search", "password"].includes(type)) continue;
    if (/captcha/i.test(el.name + " " + el.id) || el.closest("[class*=captcha]")) continue;
    // 🔒 Honeypots: invisible "trap" fields only bots fill in (Workday: "beecatcher"). Never touch them.
    if (/beecatcher|honeypot|honey_pot/i.test(el.name + " " + el.id + " " + aid(el))) continue;
    if (el.disabled) continue;
    // Workday internals: the hidden input inside a dropdown button, radios inside an open result list.
    if (el.closest("button") || el.closest('[data-automation-id="activeListContainer"]')) continue;
    if (el.closest('[data-automation-id="multiSelectContainer"]')) {
      const box = el.closest('[data-automation-id="multiSelectContainer"]');
      const picked = [...box.querySelectorAll('[data-automation-id="selectedItem"]')].map((p) => clean(p.textContent));
      out.push({
        ref: mark(el), kind: "multiselect", question: labelFor(el), required: el.getAttribute("aria-required") === "true",
        idHint: clean(el.id + " " + aid(el)), current: picked.join(" | "),
      });
      continue;
    }
    const isChoice = type === "radio" || type === "checkbox";
    // File inputs and styled radios/checkboxes are often invisible (a pretty button is shown instead).
    if (type !== "file" && !isChoice && !visible(el)) continue;
    if (isChoice && !visible(el) && !visible(el.closest("label") || el.parentElement)) continue;
    const required = el.required || el.getAttribute("aria-required") === "true";

    // Ashby keeps a hidden checkbox behind its Yes/No buttons — the buttons are the real control.
    if (type === "checkbox" && el.tabIndex === -1 && el.parentElement && el.parentElement.querySelector("button")) continue;

    if (isChoice) {
      // Radios share a name. Checkboxes sometimes have one name PER option (Ashby) → group by question.
      const key = (type === "checkbox" ? groupQuestion(el) : "") || el.name || groupQuestion(el) || "g" + n;
      let g = groups.get(key);
      if (!g) {
        g = { ref: "g" + n++, kind: type, question: groupQuestion(el), required, options: [], idHint: clean((el.id || "") + " " + (el.name || "") + " " + aid(el)) };
        groups.set(key, g);
        out.push(g);
      }
      g.options.push({ ref: mark(el), label: optionLabel(el) });
      g.required = g.required || required;
      continue;
    }

    const isCombo = el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list";
    const kind = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : type === "file" ? "file" : isCombo ? "combobox" : "text";
    const f = {
      ref: mark(el), kind, question: labelFor(el), required, inputType: type,
      idHint: clean((el.id || "") + " " + (el.name || "") + " " + aid(el)),
      autocomplete: isCombo || el.id === "location-input",
      current: kind === "text" || kind === "textarea" ? clean(el.value).slice(0, 300) : undefined,
    };
    if (kind === "select") {
      f.options = [...el.options].filter((o) => o.value).map((o) => ({ ref: f.ref, label: clean(o.text), value: o.value }));
    }
    out.push(f);
  }

  // Ashby-style Yes/No buttons.
  // 🔒 A <button> with NO type attribute is a SUBMIT button inside a form — clicking "Yes" could send
  // the application! So we set type="button" on them first (their own click handler still works),
  // and skip any button that is explicitly type="submit".
  const btnGroups = new Map();
  for (const b of document.querySelectorAll("button")) {
    const t = clean(b.textContent);
    if (!/^(yes|no)$/i.test(t) || !visible(b)) continue;
    if (b.getAttribute("type") === "submit") continue;
    if (!b.getAttribute("type")) b.setAttribute("type", "button");
    let g = btnGroups.get(b.parentElement);
    if (!g) {
      g = { ref: "g" + n++, kind: "buttons", question: groupQuestion(b), required: false, options: [] };
      btnGroups.set(b.parentElement, g);
      out.push(g);
    }
    g.options.push({ ref: mark(b), label: t });
  }

  // Workday dropdowns: <button aria-haspopup="listbox">. Their options only exist after a click,
  // so Node opens each one later. (The language/settings menus in the header are skipped.)
  for (const b of document.querySelectorAll('button[aria-haspopup="listbox"]')) {
    if (aid(b) === "utilityMenuButton" || !b.closest('[data-automation-id^="formField-"]') || !visible(b)) continue;
    if (b.getAttribute("type") !== "button") continue; // 🔒 never a button that could submit
    const shown = clean(b.textContent);
    out.push({
      ref: mark(b), kind: "listbox", question: labelFor(b), required: /required/i.test(b.getAttribute("aria-label") || ""),
      idHint: clean(b.id + " " + (b.getAttribute("name") || "")), current: /^select one$/i.test(shown) ? "" : shown,
    });
  }

  for (const g of out) if (g.options && !g.question && g.options.length === 1) g.question = g.options[0].label;
  return { fields: out, next: n };
}`;

/**
 * Reads back the CURRENT value of some fields (what you typed or picked), using their data-jarvis refs.
 * Used as: (READ_VALUES_FN)([{ key, kind, ref, options }])  →  { key: "your answer" }
 */
export const READ_VALUES_FN = String.raw`(targets) => {
  const q = (ref) => document.querySelector('[data-jarvis="' + ref + '"]');
  const out = {};
  for (const t of targets) {
    let v = "";
    if (t.kind === "radio" || t.kind === "checkbox") {
      v = t.options.filter((o) => { const el = q(o.ref); return el && el.checked; }).map((o) => o.label).join(" | ");
    } else if (t.kind === "buttons") {
      v = t.options.filter((o) => { const el = q(o.ref); return el && el.getAttribute("aria-pressed") === "true"; }).map((o) => o.label).join(" | ");
    } else {
      const el = q(t.ref);
      if (!el) continue;
      if (t.kind === "select") v = el.value ? el.options[el.selectedIndex].text : "";
      else if (t.kind === "listbox") v = /^select one$/i.test(el.textContent.trim()) ? "" : el.textContent;
      else if (t.kind === "multiselect") {
        const box = el.closest('[data-automation-id="multiSelectContainer"]');
        v = box ? [...box.querySelectorAll('[data-automation-id="selectedItem"]')].map((x) => x.textContent.trim()).join(" | ") : "";
      } else if (t.kind === "combobox") {
        // react-select shows the picked value in a separate element, not in the <input>
        const box = el.closest("[class*=control]");
        const shown = box ? [...box.querySelectorAll("[class*=single-value], [class*=multi-value__label]")] : [];
        v = shown.length ? shown.map((x) => x.textContent.trim()).join(" | ") : el.value;
      } else v = el.value;
    }
    v = (v || "").replace(/\s+/g, " ").trim();
    if (v) out[t.key] = v;
  }
  return out;
}`;
