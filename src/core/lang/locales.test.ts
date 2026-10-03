import assert from "node:assert/strict";
import test from "node:test";
import { learningLanguageName, translate, translatePlural, translator } from "../../shared/i18n";
import { leaksTargetScript } from "../../shared/languages";
import { effectiveLocale, matchLocale, matchOne } from "../../shared/locales";

test("locales: system languages map to a UI locale", () => {
  assert.equal(matchOne("de-AT"), "de");
  assert.equal(matchOne("zh-Hans-CN"), "zh-Hans");
  assert.equal(matchOne("zh-Hant-TW"), "zh-Hant");
  assert.equal(matchOne("zh-TW"), "zh-Hant");
  assert.equal(matchOne("zh-HK"), "zh-Hant");
  assert.equal(matchOne("zh_CN"), "zh-Hans");
  assert.equal(matchOne("pt-PT"), "pt-BR");
  assert.equal(matchOne("tl-PH"), null);
  assert.equal(matchLocale(["tl-PH", "ar-SA", "fr-CA"]), "fr");
  assert.equal(matchLocale(["tl-PH"]), "en");
  assert.equal(matchLocale([]), "en");
  assert.equal(effectiveLocale(undefined, ["ja-JP"]), "ja");
  assert.equal(effectiveLocale("system", ["ko-KR"]), "ko");
  assert.equal(effectiveLocale("ru", ["ko-KR"]), "ru");
});

test("i18n: English passes through, placeholders fill, missing keys fall back", () => {
  assert.equal(translate("en", "Hello {name}", { name: "Yufeng" }), "Hello Yufeng");
  assert.equal(translate("de", "a string nobody translated {n}", { n: 1234 }), "a string nobody translated 1.234");
  assert.equal(translatePlural("en", 1, "{count} word", "{count} words"), "1 word");
  assert.equal(translatePlural("en", 3, "{count} word", "{count} words"), "3 words");
  assert.equal(learningLanguageName("de", "es"), "Spanisch");
  assert.equal(learningLanguageName("en", "es"), "Spanish");
  assert.equal(translator("fr").language("ja"), "Japonais");
});

test("languages: target-script leak check depends on the interface script", () => {
  assert.equal(leaksTargetScript("Tell a friend you went hiking.", "zh", "en"), false);
  assert.equal(leaksTargetScript("Tell a friend 我去爬山.", "zh", "en"), true);
  // Japanese interface, Chinese target: both use Han characters, so no reliable check.
  assert.equal(leaksTargetScript("友達に伝えて", "zh", "ja"), false);
  assert.equal(leaksTargetScript("Сказать другу", "es", "ru"), false);
  assert.equal(leaksTargetScript("Dile a un amigo", "ru", "es"), false);
  assert.equal(leaksTargetScript("Скажи другу", "ru", "es"), true);
});
