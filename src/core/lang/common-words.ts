// The most common words of each Latin-script language, lower case, as written (inflected forms
// included). Two uses when deciding which words of a learner message are in the language they
// learn (spaced.ts, learnerWords): words of the learner's own language when no dictionary is
// installed, and words of the target language when no dictionary is installed. Written for
// Sayfern; a dictionary, once installed, is the better source for both.

const list = (s: string): ReadonlySet<string> => new Set(s.trim().split(/\s+/));

export const COMMON_WORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: list(`
    the a an and or but if so because than then that this these those there here what which who whom whose when where why how
    i me my mine myself you your yours yourself he him his himself she her hers herself it its itself we us our ours they them their theirs
    is am are was were be been being have has had having do does did done doing will would shall should can could may might must
    not no yes don't doesn't didn't can't won't isn't aren't wasn't weren't i'm i've i'll i'd you're it's that's there's what's let's
    to of in on at by for with from about into over under after before between through during without again also just only very too
    really still even more most much many some any all each every few other another such same own both either neither
    one two three four five six seven eight nine ten first last next new old good bad great little big small long high right left
    want wants wanted know knows knew think thinks thought say says said tell told ask asked go goes went going come came get got
    make made take took see saw seen look looked give gave find found use used work worked call called try tried need needed
    feel felt like liked love loved mean means meant help helped write wrote written speak spoke learn learned learning understand understood
    word words sentence language spanish english french german italian portuguese chinese japanese korean russian vietnamese
    please thanks thank sorry hello hi okay ok well maybe today tomorrow yesterday now time day week year people thing things way
    something nothing anything everything someone anyone everyone translate translation meaning
  `),
  es: list(`
    a el la los las un una unos unas y o pero si que porque como cuando donde quien cual qué cómo cuándo dónde quién cuál por para
    de del al en con sin sobre entre hasta desde hacia contra según durante muy más menos también tampoco ya todavía aún solo
    yo tú él ella usted nosotros nosotras vosotros ellos ellas ustedes me te se nos os le les lo mi mis tu tus su sus nuestro nuestra
    es soy eres somos son era fue ser estar estoy estás está estamos están estaba he has ha hemos han había hay tengo tienes tiene
    tenemos tienen quiero quieres quiere puedo puedes puede podemos voy vas va vamos van hago haces hace sé sabes sabe digo dice
    no sí bien mal mucho mucha muchos muchas poco todo toda todos todas otro otra este esta estos estas ese esa eso esto aquí allí
    hola gracias adiós bueno buena buenos buenas día días noche hoy mañana ayer ahora siempre nunca casa tiempo año vez cosa
    gente hombre mujer amigo amiga palabra idioma español inglés hablar decir hacer tener ir ver dar saber querer poder llamo
  `),
  fr: list(`
    le la les l un une des du de d et ou mais si que qu qui quoi quand où comment pourquoi parce car comme dans en sur sous avec sans
    pour par chez vers entre depuis pendant avant après très plus moins aussi encore déjà toujours jamais seulement bien mal
    je j moi tu toi il elle on nous vous ils elles me m te t se s lui leur leurs mon ma mes ton ta tes son sa ses notre nos votre vos
    est suis es sommes êtes sont était été être ai as a avons avez ont avait avoir fais fait faire vais va allons allez vont aller
    veux veut voulons voulez peux peut pouvons pouvez sais sait dis dit dire vois voit voir ne pas non oui ça ce cet cette ces
    tout tous toute toutes autre autres même beaucoup peu rien personne quelque chose ici là bonjour salut merci au revoir
    jour nuit aujourd'hui demain hier maintenant temps an année fois homme femme ami amie mot langue français anglais parler
    c'est il y
  `),
  de: list(`
    der die das den dem des ein eine einen einem einer eines und oder aber wenn dass weil als ob wie was wer wo wann warum
    in im an am auf aus bei mit nach von vom zu zum zur für über unter vor hinter neben zwischen durch ohne gegen um bis seit
    ich mich mir du dich dir er ihn ihm sie es wir uns ihr euch ihnen mein meine meinen dein deine sein seine unser euer
    ist bin bist sind seid war waren sein habe hast hat haben habt hatte werde wirst wird werden kann kannst können will willst
    wollen muss musst müssen mache machst macht machen gehe gehst geht gehen sage sagt sagen weiß weißt wissen sehe siehst sieht
    nicht kein keine keinen ja nein doch auch noch schon nur sehr mehr viel viele wenig alle alles andere hier dort jetzt heute
    morgen gestern immer nie hallo danke bitte tschüss gut schlecht groß klein tag nacht zeit jahr mal mann frau freund freundin
    wort sprache deutsch englisch sprechen heißt heiße
  `),
  it: list(`
    il lo la i gli le un uno una e o ma se che chi cosa come quando dove perché quale di del dello della dei degli delle a al allo
    alla ai agli alle da dal dalla in nel nella nei con su sul sulla per tra fra senza molto più meno anche ancora già sempre mai
    solo io me mi tu te ti lui lei noi ci voi vi loro si mio mia miei mie tuo tua suo sua nostro nostra vostro vostra
    è sono sei siamo siete era essere ho hai ha abbiamo avete hanno avere faccio fai fa facciamo fare vado vai va andiamo andare
    voglio vuoi vuole possiamo posso puoi può so sai sa dico dici dice dire non sì no bene male tutto tutti tutta altro altra
    questo questa quello quella qui qua lì là ciao grazie prego buongiorno buonasera giorno notte oggi domani ieri adesso ora tempo
    anno volta uomo donna amico amica parola lingua italiano inglese parlare chiamo
  `),
  pt: list(`
    o a os as um uma uns umas e ou mas se que quem qual quando onde como porque porquê por para de do da dos das em no na nos nas
    num numa com sem sobre entre até desde muito mais menos também ainda já sempre nunca só eu me mim tu te ti ele ela você vocês
    nós nos vós eles elas lhe lhes meu minha meus minhas teu tua seu sua nosso nossa é sou és somos são era foi ser estar estou estás
    está estamos estão tenho tens tem temos têm ter quero queres quer posso podes pode podemos vou vais vai vamos vão ir faço fazes
    faz fazer sei sabes sabe saber digo diz dizer não sim bem mal tudo todo toda todos todas outro outra este esta isto esse essa
    isso aquele aquela aqui ali lá olá oi obrigado obrigada adeus tchau bom boa dia noite hoje amanhã ontem agora tempo ano vez
    homem mulher amigo amiga palavra língua português inglês falar chamo
  `),
  vi: list(`
    tôi tao mình bạn anh chị em ông bà cô chú nó họ chúng ta chúng tôi các những cái con người là có không được và hoặc nhưng nếu
    thì mà vì nên của cho với ở trong ngoài trên dưới từ đến về đi lại làm nói biết muốn cần thích yêu học hiểu xem thấy nghe viết
    đọc ăn uống ngủ này đó kia đây đâu gì ai sao nào bao nhiêu khi lúc rồi đã đang sẽ vẫn cũng rất lắm quá hơn nhất nhiều ít mọi
    tất cả một hai ba bốn năm sáu bảy tám chín mười ngày đêm hôm nay mai qua bây giờ thời gian xin chào cảm ơn vâng dạ tiếng
    việt anh pháp đức nhật hàn trung từ câu
  `),
};

/** Strips common endings so a plural or past form of an own-language word is still found. */
const ENDINGS: Readonly<Record<string, readonly string[]>> = {
  en: ["'s", "s", "es", "ed", "d", "ing", "ly"],
  es: ["s", "es"],
  fr: ["s", "x", "e", "es"],
  de: ["e", "en", "n", "er", "es", "s"],
  it: [],
  pt: ["s", "es"],
  vi: [],
};

/** The word and the forms it may come from, for a lookup in `language` (base code: "en", "pt"). */
export function wordForms(word: string, language: string): string[] {
  const out = [word];
  for (const end of ENDINGS[language] ?? []) {
    if (word.length > end.length + 2 && word.endsWith(end)) out.push(word.slice(0, -end.length));
  }
  if (language === "en" && word.endsWith("ies") && word.length > 4) out.push(`${word.slice(0, -3)}y`);
  return out;
}
