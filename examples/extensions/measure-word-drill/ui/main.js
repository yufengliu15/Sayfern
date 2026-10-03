// The drill screen. Talks to Sayfern only through window.sayfern (the SDK).
import { check, makeRound, pickNouns, random, score } from "./drill.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let questions = [];
let answers = [];
let index = 0;
let picked = null;

async function start() {
  let words = [];
  try {
    words = (await sayfern.anki.words({ status: "all", limit: 200 })).items;
  } catch {
    words = [];
  }
  const { nouns, fromAnki } = pickNouns(words, 10);
  $("source").replaceChildren(
    document.createTextNode(fromAnki ? "Nouns from your Anki · " : "Sample nouns (none from your Anki yet) · "),
    el("span", "foot-words", nouns.slice(0, 4).map((n) => n.word).join(" · ")),
  );
  questions = makeRound(nouns, random(Date.now()), 10);
  answers = [];
  index = 0;
  show();
}

function show() {
  picked = null;
  const q = questions[index];
  $("progress").textContent = `${index + 1} of ${questions.length}`;
  const blank = el("span", "blank", "");
  const prompt = el("div", "prompt");
  prompt.append("一", blank, q.noun);
  const choices = el("div", "sf-choices");
  const feedback = el("div", "feedback", "Pick the measure word.");
  q.choices.forEach((c, i) => {
    const b = el("button", "sf-choice", c);
    b.title = `${c} (key ${i + 1})`;
    b.onclick = () => choose(c, { blank, choices, feedback });
    choices.append(b);
  });
  const body = [prompt];
  if (q.reading) body.push(el("div", "reading", q.reading));
  body.push(choices, feedback);
  $("body").replaceChildren(...body);
}

function choose(choice, ui) {
  if (picked) return;
  picked = choice;
  const q = questions[index];
  const r = check(q, choice);
  answers.push({ noun: q.noun, choice, correct: r.correct });
  ui.blank.textContent = choice;
  ui.blank.classList.add(r.correct ? "right" : "wrong");
  for (const b of ui.choices.children) {
    b.disabled = true;
    if (b.textContent === q.answer) b.classList.add("right");
    else if (b.textContent === choice) b.classList.add("wrong");
  }
  ui.feedback.textContent = r.feedback;
  sayfern.results.record({ item: q.noun, correct: r.correct, answer: choice, expected: q.answer, kind: "measure-word" }).catch(() => {});
  const next = el("button", "sf-btn primary", index + 1 < questions.length ? "Next" : "See score");
  next.onclick = advance;
  $("body").append(next);
  next.focus();
}

function advance() {
  index++;
  if (index < questions.length) return show();
  const s = score(answers);
  $("progress").textContent = "Done";
  const again = el("button", "sf-btn primary", "Again");
  again.onclick = () => void start();
  $("body").replaceChildren(el("div", "done", `${s.right} of ${s.total} right`), again);
  again.focus();
}

document.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  const n = Number(e.key);
  const buttons = document.querySelectorAll(".sf-choice");
  if (n >= 1 && n <= buttons.length && !picked) buttons[n - 1].click();
});

start();
