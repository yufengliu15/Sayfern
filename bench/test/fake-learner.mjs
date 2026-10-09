#!/usr/bin/env node
// Stand-in for `claude -p --output-format json` playing the simulated learner in the
// benchmark selftest. Reads the prompt on stdin and answers by message number: a planned
// mistake on message 2, a reported mistake that is not in the text on message 3, prose
// around the JSON on message 4, clean messages otherwise.
let prompt = "";
for await (const c of process.stdin) prompt += c;
const n = Number(prompt.match(/This is your message (\d+) of/)?.[1] ?? 1);
const replies = {
  2: { text: "要是你有时间，就我们一起去看比赛吧！", errors: [{ id: "yaoshi-jiu", original: "就我们一起去", correct: "我们就一起去", pattern: "要是…，(subject) 就 + verb" }] },
  3: { text: "我周末不是在家，就是在实验室。", errors: [{ id: "phantom", original: "或者去实验室", correct: "就是去实验室", pattern: "不是…就是…" }] },
};
const body = replies[n] ?? { text: `好的，这是我的第${n}条消息。`, errors: [] };
const result = n === 4 ? `Here is my message:\n${JSON.stringify(body)}` : JSON.stringify(body);
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result }) + "\n");
