// Dictionary-checked lemmatizers for languages written with spaces (and Korean).
//
// No morphological dictionaries are bundled. Each language has a small table of irregular forms
// and suffix rules that propose dictionary forms ("hablé" → hablar, "Tische" → Tisch,
// "говорила" → говорить); the first candidate that the installed dictionary knows wins. Without a
// dictionary, only the irregular tables apply. Wrong guesses are cheap: a candidate the dictionary
// doesn't know is never returned.
import type { Language } from "../../shared/records";

export type Has = (word: string) => boolean;

/** Ordered candidate dictionary forms for a lower-case word form (may include the form itself). */
export type CandidateFn = (w: string) => string[];

/** Strip `suffix` from `w` and append each of `ends` (when the stem stays long enough). */
function swap(w: string, suffix: string, ends: string[], minStem = 2): string[] {
  if (!w.endsWith(suffix)) return [];
  const stem = w.slice(0, w.length - suffix.length);
  if ([...stem].length < minStem) return [];
  return ends.map((e) => stem + e);
}

function rules(w: string, table: [string, string[]][], minStem = 2): string[] {
  const out: string[] = [];
  for (const [suffix, ends] of table) out.push(...swap(w, suffix, ends, minStem));
  return out;
}

const irregular = (pairs: string): Map<string, string> => {
  const m = new Map<string, string>();
  for (const group of pairs.trim().split(/\s*;\s*/)) {
    const [lemma, forms] = group.split(":");
    if (!lemma || !forms) continue;
    for (const f of forms.split(",")) if (f.trim()) m.set(f.trim(), lemma.trim());
  }
  return m;
};

// ---------------------------------------------------------------- English

const EN_IRREGULAR = irregular(`
be: am,is,are,was,were,been,being; have: has,had,having; do: does,did,done,doing; go: goes,went,gone,going;
say: said; make: made; get: got,gotten; know: knew,known; think: thought; take: took,taken; see: saw,seen;
come: came; give: gave,given; find: found; tell: told; feel: felt; become: became; leave: left; put: put;
bring: brought; begin: began,begun; keep: kept; hold: held; write: wrote,written; stand: stood; hear: heard;
let: let; mean: meant; set: set; meet: met; run: ran; pay: paid; sit: sat; speak: spoke,spoken; lie: lay,lain;
lead: led; read: read; grow: grew,grown; lose: lost; fall: fell,fallen; send: sent; build: built; understand: understood;
draw: drew,drawn; break: broke,broken; spend: spent; cut: cut; rise: rose,risen; drive: drove,driven; buy: bought;
wear: wore,worn; choose: chose,chosen; seek: sought; throw: threw,thrown; catch: caught; deal: dealt; win: won;
forget: forgot,forgotten; teach: taught; eat: ate,eaten; drink: drank,drunk; sing: sang,sung; swim: swam,swum;
fly: flew,flown; sleep: slept; sell: sold; fight: fought; hide: hid,hidden; ride: rode,ridden; wake: woke,woken;
child: children; man: men; woman: women; person: people; foot: feet; tooth: teeth; mouse: mice; good: better,best;
bad: worse,worst; far: further,farther; I: me; we: us; they: them; he: him; she: her
`);

const enCandidates: CandidateFn = (w) => {
  const out: string[] = [];
  const irr = EN_IRREGULAR.get(w);
  if (irr) out.push(irr);
  out.push(
    ...rules(w, [
      ["ies", ["y"]],
      ["ied", ["y"]],
      ["ves", ["f", "fe"]],
      ["es", ["", "e"]],
      ["s", [""]],
      ["ed", ["", "e"]],
      ["ing", ["", "e"]],
      ["ier", ["y"]],
      ["iest", ["y"]],
      ["er", ["", "e"]],
      ["est", ["", "e"]],
      ["ly", [""]],
    ]),
  );
  // Doubled consonant: stopped → stop, running → run.
  const m = w.match(/^(.+?)([bcdfgklmnprstvz])\2(ed|ing|er|est)$/);
  if (m) out.push(m[1] + m[2]);
  return out;
};

// ---------------------------------------------------------------- Spanish

const ES_IRREGULAR = irregular(`
ser: soy,eres,es,somos,sois,son,era,eras,éramos,eran,fui,fuiste,fue,fuimos,fueron,sea,seas,seamos,sean,sido,siendo,sería,será;
ir: voy,vas,va,vamos,vais,van,iba,ibas,íbamos,iban,vaya,vayas,vayamos,vayan,yendo,ido;
estar: estoy,estás,está,estamos,están,estuve,estuvo,estuvieron,esté,estén; haber: he,has,ha,hemos,han,hay,había,hubo,haya,habrá;
tener: tengo,tienes,tiene,tienen,tuve,tuvo,tuvimos,tuvieron,tenga,tendré,tendrá; hacer: hago,hice,hizo,hicimos,hicieron,haga,haré,hará,hecho;
decir: digo,dices,dice,dicen,dije,dijo,dijeron,diga,diré,dirá,dicho; poder: puedo,puedes,puede,pueden,pude,pudo,pudieron,pueda,podré,podrá;
querer: quiero,quieres,quiere,quieren,quise,quiso,quiera,querré; saber: sé,sabes,sabe,supe,supo,sepa,sabré; poner: pongo,puse,puso,ponga,pondré,puesto;
venir: vengo,vienes,viene,vienen,vine,vino,vinieron,venga,vendré; ver: veo,ves,ve,vi,vio,vea,visto; dar: doy,das,da,dan,di,dio,dieron,dé;
salir: salgo,salga,saldré; traer: traigo,traje,trajo,traiga; oír: oigo,oye,oyen,oyó; conocer: conozco,conozca; volver: vuelto; escribir: escrito;
abrir: abierto; romper: roto; morir: muerto; él: lo,le; ella: la
`);

const ES_VERB: [string, string[]][] = [
  // -ar
  ...["o", "as", "a", "amos", "áis", "an", "é", "aste", "ó", "asteis", "aron", "aba", "abas", "ábamos", "abais", "aban", "ado", "ada", "ados", "adas", "ando", "e", "es", "emos", "éis", "en", "ara", "aras", "aran", "ase"].map(
    (e): [string, string[]] => [e, ["ar"]],
  ),
  ...["aré", "arás", "ará", "aremos", "aréis", "arán", "aría", "arías", "aríamos", "arían"].map((e): [string, string[]] => [e, ["ar"]]),
  // -er / -ir
  ...["o", "es", "e", "emos", "imos", "éis", "ís", "en", "í", "iste", "ió", "isteis", "ieron", "ía", "ías", "íamos", "íais", "ían", "ido", "ida", "idos", "idas", "iendo", "a", "as", "amos", "an", "iera", "ieras", "ieran"].map(
    (e): [string, string[]] => [e, ["er", "ir"]],
  ),
  ...["eré", "erás", "erá", "eremos", "erán", "ería", "erías", "erían", "iré", "irás", "irá", "iremos", "irán", "iría", "irías", "irían"].map((e): [string, string[]] => [
    e,
    [e.startsWith("e") ? "er" : "ir"],
  ]),
];

/** Stem vowel changes undone: puedo → podo (→ poder), quiero → quero, pido → pedo. */
function undoStemChange(w: string): string[] {
  const out: string[] = [];
  if (w.includes("ue")) out.push(w.replace(/ue(?=[^aeiou]*[aeiouáéíóú]?[^aeiou]*$)/, "o"));
  if (w.includes("ie")) out.push(w.replace(/ie(?=[^aeiou]*[aeiouáéíóú]?[^aeiou]*$)/, "e"));
  if (/i[^aeiou]+[aeo]s?$|i[^aeiou]+en$/.test(w)) out.push(w.replace(/i(?=[^aeiou]+(?:[aeo]s?|en)$)/, "e"));
  return out;
}

const esCandidates: CandidateFn = (w) => {
  const out: string[] = [];
  const irr = ES_IRREGULAR.get(w);
  if (irr) out.push(irr);
  // Enclitic pronouns: dámelo → da, comerlo → comer.
  const encl = w.match(/^(.+?(?:ar|er|ir|ando|iendo))(me|te|se|lo|la|le|nos|os|los|las|les)+$/);
  if (encl) out.push(encl[1].normalize("NFD").replace(/́/g, "").normalize("NFC"));
  const nouns = rules(w, [
    ["ces", ["z"]],
    ["es", [""]],
    ["s", [""]],
    ["a", ["o"]],
    ["as", ["o"]],
    ["ísimo", ["o", ""]],
    ["ísima", ["o", ""]],
  ]);
  const verbs = rules(w, ES_VERB);
  for (const v of [...verbs]) out.push(v, ...undoStemChange(v));
  out.push(...nouns);
  return out;
};

// ---------------------------------------------------------------- Portuguese

const PT_IRREGULAR = irregular(`
ser: sou,és,é,somos,são,era,eras,éramos,eram,fui,foi,fomos,foram,seja,sejam,sido,sendo,será,seria;
ir: vou,vais,vai,vamos,vão,ia,iam,fui,foi,fomos,foram,vá,ido,indo; estar: estou,está,estamos,estão,estava,estive,esteve,estiveram,esteja;
ter: tenho,tens,tem,temos,têm,tinha,tive,teve,tiveram,tenha,terá; haver: há,havia,houve,haja; fazer: faço,faz,fazem,fiz,fez,fizeram,faça,farei,fará,feito;
dizer: digo,diz,dizem,disse,disseram,diga,direi,dirá,dito; poder: posso,pode,podem,pude,pôde,puderam,possa; querer: quero,quer,querem,quis,quiseram,queira;
saber: sei,sabe,soube,saiba; pôr: ponho,põe,pus,pôs,posto; vir: venho,vem,vêm,vim,veio,vieram,venha,vindo; ver: vejo,vê,veem,vi,viu,viram,veja,visto;
dar: dou,dá,dão,dei,deu,deram,dê; trazer: trago,trouxe,traga; ler: leio,lê,leem; escrever: escrito; abrir: aberto
`);

const PT_VERB: [string, string[]][] = [
  ...["o", "as", "a", "amos", "ais", "am", "ei", "aste", "ou", "astes", "aram", "ava", "avas", "ávamos", "avam", "ado", "ada", "ados", "adas", "ando", "e", "es", "emos", "em", "ar", "aria", "ará", "arei", "arão", "asse"].map(
    (e): [string, string[]] => [e, ["ar"]],
  ),
  ...["o", "es", "e", "emos", "imos", "em", "i", "iste", "eu", "iu", "eram", "iram", "ia", "ias", "íamos", "iam", "ido", "ida", "idos", "idas", "endo", "indo", "a", "as", "amos", "am", "esse", "isse"].map(
    (e): [string, string[]] => [e, ["er", "ir"]],
  ),
];

const ptCandidates: CandidateFn = (w) => {
  const out: string[] = [];
  const irr = PT_IRREGULAR.get(w);
  if (irr) out.push(irr);
  out.push(
    ...rules(w, PT_VERB),
    ...rules(w, [
      ["ões", ["ão"]],
      ["ães", ["ão"]],
      ["ãos", ["ão"]],
      ["ais", ["al"]],
      ["éis", ["el"]],
      ["óis", ["ol"]],
      ["is", ["il"]],
      ["ns", ["m"]],
      ["es", [""]],
      ["s", [""]],
      ["a", ["o"]],
      ["as", ["o"]],
    ]),
  );
  return out;
};

// ---------------------------------------------------------------- Italian

const IT_IRREGULAR = irregular(`
essere: sono,sei,è,siamo,siete,ero,eri,era,eravamo,erano,fui,fu,furono,sia,siano,stato,stata,stati,state,sarò,sarà,sarebbe;
avere: ho,hai,ha,abbiamo,avete,hanno,avevo,aveva,ebbi,ebbe,abbia,avrò,avrà,avuto; andare: vado,vai,va,andiamo,vanno,vada,andrò,andato;
fare: faccio,fai,fa,facciamo,fanno,feci,fece,fatto,faccia,farò; dire: dico,dici,dice,diciamo,dicono,dissi,disse,detto,dica;
potere: posso,puoi,può,possiamo,possono,potrò,possa; volere: voglio,vuoi,vuole,vogliamo,vogliono,volli,volle,voglia,vorrò;
dovere: devo,devi,deve,dobbiamo,devono,debba,dovrò; sapere: so,sai,sa,sappiamo,sanno,seppi,seppe,sappia,saprò; stare: sto,stai,sta,stanno,stette,stia;
venire: vengo,vieni,viene,vengono,venni,venne,venuto,venga; vedere: vedo,vidi,vide,visto,veda,vedrò; dare: do,dai,dà,danno,diedi,diede,dato;
uscire: esco,esci,esce,escono; prendere: presi,prese,preso; mettere: misi,mise,messo; scrivere: scrissi,scrisse,scritto; leggere: lessi,lesse,letto
`);

const IT_VERB: [string, string[]][] = [
  ...["o", "i", "a", "iamo", "ate", "ano", "avo", "avi", "ava", "avamo", "avate", "avano", "ai", "ò", "ammo", "aste", "arono", "ato", "ata", "ati", "ate", "ando", "erò", "erai", "erà", "eremo", "erete", "eranno", "erei", "erebbe", "ino"].map(
    (e): [string, string[]] => [e, ["are"]],
  ),
  ...["o", "i", "e", "iamo", "ete", "ite", "ono", "evo", "eva", "evano", "ivo", "iva", "ivano", "uto", "uta", "uti", "ito", "ita", "iti", "endo", "isco", "isci", "isce", "iscono", "a", "ano"].map(
    (e): [string, string[]] => [e, ["ere", "ire"]],
  ),
];

const itCandidates: CandidateFn = (w) => {
  const out: string[] = [];
  const irr = IT_IRREGULAR.get(w);
  if (irr) out.push(irr);
  out.push(
    ...rules(w, IT_VERB),
    ...rules(w, [
      ["chi", ["co"]],
      ["ghi", ["go"]],
      ["che", ["ca"]],
      ["ghe", ["ga"]],
      ["i", ["o", "e", "a"]],
      ["e", ["a", "o"]],
      ["a", ["o"]],
    ]),
  );
  return out;
};

// ---------------------------------------------------------------- French

const FR_IRREGULAR = irregular(`
être: suis,es,est,sommes,êtes,sont,étais,était,étions,étiez,étaient,fus,fut,furent,sois,soit,soient,été,serai,sera,seront,serait;
avoir: ai,as,a,avons,avez,ont,avais,avait,avaient,eus,eut,aie,ait,aient,eu,aurai,aura,auront,aurait; aller: vais,vas,va,allons,allez,vont,allais,allait,allé,allée,allés,irai,ira,iront,aille;
faire: fais,fait,faisons,faites,font,faisais,faisait,fis,fit,fasse,ferai,fera,feront,ferait; dire: dis,dit,disons,dites,disent,disait,dise,dirai;
pouvoir: peux,peut,pouvons,pouvez,peuvent,pouvais,pouvait,pus,put,pu,puisse,pourrai,pourra,pourrait; vouloir: veux,veut,voulons,voulez,veulent,voulait,voulu,veuille,voudrais,voudrait;
devoir: dois,doit,devons,devez,doivent,devait,dû,doive,devrai,devrait; savoir: sais,sait,savons,savez,savent,savait,su,sache,saurai;
voir: vois,voit,voyons,voyez,voient,voyait,vu,vue,voie,verrai; venir: viens,vient,venons,venez,viennent,venait,venu,venue,vienne,viendrai;
prendre: prends,prend,prenons,prenez,prennent,prenait,pris,prise,prenne; mettre: mets,met,mis,mise; partir: pars,part,parti,partie;
connaître: connais,connaît,connu; croire: crois,croit,cru; vivre: vis,vit,vécu; écrire: écris,écrit,écrite; lire: lis,lit,lu; boire: bois,boit,bu;
le: l,la,les; de: d,du,des; je: j; ne: n; que: qu; se: s; ce: c; me: m; te: t; œil: yeux
`);

const FR_VERB: [string, string[]][] = [
  ...["e", "es", "ons", "ez", "ent", "ais", "ait", "ions", "iez", "aient", "é", "ée", "és", "ées", "ant", "erai", "eras", "era", "erons", "erez", "eront", "erais", "erait", "eraient", "a", "âmes", "èrent", "asse"].map(
    (e): [string, string[]] => [e, ["er"]],
  ),
  ...["is", "it", "issons", "issez", "issent", "issais", "issait", "issaient", "i", "ie", "ies", "issant", "irai", "ira", "iront", "irais", "irait"].map((e): [string, string[]] => [e, ["ir"]]),
  ...["s", "", "ons", "ez", "ent", "ais", "ait", "aient", "u", "ue", "ant", "rai", "ra", "ront", "rait"].map((e): [string, string[]] => [e, ["re"]]),
];

const frCandidates: CandidateFn = (w) => {
  const out: string[] = [];
  const irr = FR_IRREGULAR.get(w);
  if (irr) out.push(irr);
  // Stem changes: achète → acheter, appelle → appeler, jette → jeter.
  const acc = w.replace(/è(?=[^aeiouyéèêë]+(?:e|es|ent)$)/, "e");
  const dbl = w.replace(/(ll|tt)(?=(?:e|es|ent)$)/, (m) => m[0]);
  const forms = [w, ...(acc !== w ? [acc] : []), ...(dbl !== w ? [dbl] : [])];
  for (const f of forms) out.push(...rules(f, FR_VERB));
  out.push(
    ...rules(w, [
      ["aux", ["al", "ail"]],
      ["eaux", ["eau"]],
      ["x", [""]],
      ["s", [""]],
      ["euse", ["eux", "eur"]],
      ["euses", ["eux", "eur"]],
      ["ive", ["if"]],
      ["ives", ["if"]],
      ["elle", ["el"]],
      ["enne", ["en"]],
      ["e", [""]],
      ["es", [""]],
      ["ère", ["er"]],
    ]),
  );
  return out;
};

// ---------------------------------------------------------------- German

const DE_IRREGULAR = irregular(`
sein: bin,bist,ist,sind,seid,war,warst,waren,wart,gewesen,sei,wäre,wären; haben: habe,hast,hat,habt,hatte,hattest,hatten,gehabt,hätte,hätten;
werden: werde,wirst,wird,werdet,wurde,wurden,geworden,würde,würden; gehen: ging,gingen,gegangen; kommen: kam,kamen,gekommen; sehen: sieht,siehst,sah,sahen,gesehen;
geben: gibt,gibst,gab,gaben,gegeben; nehmen: nimmt,nimmst,nahm,nahmen,genommen; essen: isst,aß,aßen,gegessen; sprechen: spricht,sprichst,sprach,gesprochen;
lesen: liest,las,gelesen; fahren: fährt,fährst,fuhr,fuhren,gefahren; laufen: läuft,lief,gelaufen; schlafen: schläft,schlief,geschlafen;
wissen: weiß,weißt,wusste,wussten,gewusst; können: kann,kannst,konnte,konnten,gekonnt,könnte; müssen: muss,musst,musste,mussten,müsste;
wollen: will,willst,wollte,wollten; dürfen: darf,darfst,durfte,dürfte; sollen: soll,sollst,sollte; mögen: mag,magst,mochte,möchte,möchtest,möchten;
denken: dachte,dachten,gedacht; bringen: brachte,gebracht; finden: fand,fanden,gefunden; trinken: trank,getrunken; schreiben: schrieb,geschrieben;
bleiben: blieb,geblieben; stehen: stand,gestanden; tun: tut,tat,getan; der: die,das,den,dem,des; ein: eine,einen,einem,einer,eines
`);

const DE_UMLAUT: [RegExp, string][] = [
  [/ä(?=[^äöü]*$)/, "a"],
  [/ö(?=[^äöü]*$)/, "o"],
  [/ü(?=[^äöü]*$)/, "u"],
  [/äu(?=[^äöü]*$)/, "au"],
];

const deCandidates: CandidateFn = (w) => {
  const out: string[] = [];
  const irr = DE_IRREGULAR.get(w);
  if (irr) out.push(irr);
  // Participles: gemacht → machen, gearbeitet → arbeiten, aufgemacht → aufmachen.
  const part = w.match(/^(.*?)ge(.+?)(e?t|en)$/);
  if (part) out.push(`${part[1]}${part[2]}en`, `${part[1]}${part[2]}n`);
  const base = rules(w, [
    ["test", ["en"]],
    ["tet", ["en"]],
    ["ten", ["en"]],
    ["te", ["en"]],
    ["st", ["en", "n"]],
    ["t", ["en", "n"]],
    ["e", ["en", "", "n"]],
    ["en", ["", "en"]],
    ["ern", ["", "er"]],
    ["er", [""]],
    ["es", [""]],
    ["em", [""]],
    ["n", [""]],
    ["s", [""]],
  ]);
  out.push(...base);
  // Plural with umlaut: Bücher → Buch, Äpfel → Apfel, Mütter → Mutter.
  for (const c of [w, ...base]) for (const [re, plain] of DE_UMLAUT) if (re.test(c)) out.push(c.replace(re, plain));
  return out;
};

// ---------------------------------------------------------------- Russian

const RU_IRREGULAR = irregular(`
быть: есть,был,была,было,были,буду,будешь,будет,будем,будете,будут; идти: иду,идёшь,идёт,идём,идёте,идут,шёл,шла,шло,шли;
ехать: еду,едешь,едет,едем,едете,едут,ехал,ехала; есть: ем,ешь,ест,едим,едите,едят,ел,ела; хотеть: хочу,хочешь,хочет,хотим,хотите,хотят;
мочь: могу,можешь,может,можем,можете,могут,мог,могла,могли; дать: дам,дашь,даст,дадим,дадут,дал,дала; взять: возьму,возьмёшь,возьмёт,взял,взяла;
я: меня,мне,мной; ты: тебя,тебе,тобой; он: его,ему,им,нём; она: её,ей,ней; мы: нас,нам,нами; вы: вас,вам,вами; они: их,им,ими,них;
человек: люди,людей,людям,людьми; ребёнок: дети,детей,детям,детьми; хороший: лучше; плохой: хуже; большой: больше; маленький: меньше
`);

const RU_NOUN_ENDS = ["", "а", "я", "о", "е", "ь", "й", "ие", "ия"];

const ruCandidates: CandidateFn = (w) => {
  const x = w.replace(/ё/g, "е");
  const out: string[] = [];
  const irr = RU_IRREGULAR.get(w) ?? RU_IRREGULAR.get(x);
  if (irr) out.push(irr);
  const forms = [x];
  // Reflexive verbs: учился → учиться.
  const refl = x.match(/^(.+?)(ся|сь)$/);
  if (refl) forms.push(refl[1]);
  for (const f of forms) {
    const suffix = f === x ? "" : "ся";
    const verbs = rules(f, [
      ["ла", ["ть"]],
      ["ло", ["ть"]],
      ["ли", ["ть"]],
      ["л", ["ть"]],
      ["ю", ["ть", "ять"]],
      ["ешь", ["ть", "ать"]],
      ["ет", ["ть", "ать"]],
      ["ем", ["ть", "ать"]],
      ["ете", ["ть", "ать"]],
      ["ют", ["ть", "ять"]],
      ["ут", ["ть"]],
      ["у", ["ть", "ать"]],
      ["ишь", ["ить", "еть"]],
      ["ит", ["ить", "еть"]],
      ["им", ["ить"]],
      ["ите", ["ить"]],
      ["ят", ["ить", "ять"]],
      ["ат", ["ать", "ить"]],
      ["й", ["ть"]],
      ["йте", ["ть"]],
      ["и", ["ить"]],
      ["ите", ["ить"]],
    ]).map((v) => v + suffix);
    out.push(...verbs);
  }
  out.push(
    ...rules(x, [
      ["ого", ["ый", "ий", "ой"]],
      ["его", ["ий", "ый"]],
      ["ому", ["ый", "ой"]],
      ["ему", ["ий"]],
      ["ым", ["ый", "ой"]],
      ["им", ["ий"]],
      ["ая", ["ый", "ой"]],
      ["яя", ["ий"]],
      ["ую", ["ый", "ой"]],
      ["юю", ["ий"]],
      ["ое", ["ый", "ой"]],
      ["ее", ["ий"]],
      ["ые", ["ый", "ой"]],
      ["ие", ["ий"]],
      ["ых", ["ый", "ой"]],
      ["их", ["ий"]],
      ["ыми", ["ый", "ой"]],
      ["ими", ["ий"]],
      ["ой", ["ый", "ой", "а"]],
      ["ей", ["ий", "я", "ь"]],
    ]),
  );
  for (const end of ["ами", "ями", "ах", "ях", "ам", "ям", "ов", "ев", "ей", "ом", "ем", "ой", "ою", "ью", "ы", "и", "у", "ю", "а", "я", "е"]) {
    if (!x.endsWith(end)) continue;
    const stem = x.slice(0, x.length - end.length);
    if ([...stem].length < 2) continue;
    for (const e of RU_NOUN_ENDS) out.push(stem + e);
  }
  return out;
};

// ---------------------------------------------------------------- Korean

/** Particles that attach to nouns (longest first). */
const KO_PARTICLES = [
  "에서부터", "으로부터", "에게서", "한테서", "으로서", "으로써", "에서는", "에서도", "에게는", "까지는", "부터는",
  "이라도", "이나마", "께서는", "에서", "에게", "한테", "으로", "까지", "부터", "처럼", "보다", "하고", "이랑", "이나", "마다", "밖에", "께서", "이라",
  "은", "는", "이", "가", "을", "를", "에", "의", "도", "만", "로", "와", "과", "랑", "나", "께",
];

/** Verb and adjective endings → the dictionary form adds 다 to the stem. */
const KO_ENDINGS = [
  "었습니다", "았습니다", "였습니다", "겠습니다", "습니다", "ㅂ니다", "었어요", "았어요", "였어요", "었어", "았어", "였어", "었다", "았다", "였다",
  "어요", "아요", "여요", "에요", "예요", "세요", "으세요", "고", "지만", "는데", "은데", "니까", "으니까", "면", "으면", "서", "어서", "아서",
  "는", "은", "을", "ㄹ", "기", "게", "지", "죠", "어", "아", "다",
];

const koCandidates: CandidateFn = (w) => {
  const out: string[] = [];
  for (const p of KO_PARTICLES) if (w.endsWith(p) && w.length > p.length) out.push(w.slice(0, w.length - p.length));
  for (const e of KO_ENDINGS) {
    if (!w.endsWith(e) || w.length <= e.length) continue;
    const stem = w.slice(0, w.length - e.length);
    out.push(`${stem}다`);
    // 해요 → 하다, 했어요 → 하다.
    if (stem.endsWith("해") || stem.endsWith("했")) out.push(`${stem.slice(0, -1)}하다`);
  }
  // Contracted forms: 가요 → 가다, 봐요 → 보다, 줘요 → 주다, 와요 → 오다.
  const c = w.match(/^(.*?)(봐|줘|와|워|해|돼|했|됐|봤|줬|왔|웠)(요|어요|어|다|습니다)?$/);
  if (c) {
    const map: Record<string, string> = { 봐: "보", 봤: "보", 줘: "주", 줬: "주", 와: "오", 왔: "오", 워: "우", 웠: "우", 해: "하", 했: "하", 돼: "되", 됐: "되" };
    out.push(`${c[1]}${map[c[2]]}다`);
  }
  if (w.endsWith("요") && w.length > 1) out.push(`${w.slice(0, -1)}다`);
  return out;
};

// ---------------------------------------------------------------- dispatch

const CANDIDATES: Partial<Record<Language, CandidateFn>> = {
  en: enCandidates,
  es: esCandidates,
  pt: ptCandidates,
  it: itCandidates,
  fr: frCandidates,
  de: deCandidates,
  ru: ruCandidates,
  ko: koCandidates,
};

export function candidates(language: Language, word: string): string[] {
  const fn = CANDIDATES[language];
  if (!fn) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of fn(word)) {
    if (!c || c === word || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/**
 * Dictionary form of `surface`, or undefined when it already is one (or nothing better is known).
 * `has` checks the installed dictionary; with no dictionary, only irregular forms resolve.
 */
export function lemmatize(language: Language, surface: string, has?: Has): string | undefined {
  const lower = language === "de" ? surface : surface.toLocaleLowerCase();
  const tryForms = language === "de" && surface !== surface.toLocaleLowerCase() ? [surface, surface.toLocaleLowerCase()] : [lower];
  for (const form of tryForms) {
    if (has?.(form)) return form === surface ? undefined : form;
  }
  for (const form of tryForms) {
    for (const c of candidates(language, form)) {
      // German nouns are capitalized in the dictionary: try both.
      const variants = language === "de" ? [c, c.charAt(0).toUpperCase() + c.slice(1)] : [c];
      for (const v of variants) {
        if (has ? has(v) : isIrregular(language, form, v)) return v;
      }
    }
  }
  return undefined;
}

function isIrregular(language: Language, form: string, lemma: string): boolean {
  const table =
    language === "en" ? EN_IRREGULAR : language === "es" ? ES_IRREGULAR : language === "pt" ? PT_IRREGULAR : language === "it" ? IT_IRREGULAR : language === "fr" ? FR_IRREGULAR : language === "de" ? DE_IRREGULAR : language === "ru" ? RU_IRREGULAR : null;
  return table?.get(form) === lemma;
}
