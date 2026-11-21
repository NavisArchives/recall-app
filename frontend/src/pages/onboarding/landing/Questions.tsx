import { Link } from "react-router-dom";
import { useLang } from "@/lib/publicLang";

/**
 * Section 11 — questions families ask, new in "Recall Website v3.dc.html".
 *
 * Seven questions, plainly answered, under rules rather than in an accordion.
 * They are not decoration: four of them are the objections that stop a
 * family buying — do they need a phone, do they need to learn an app, can I
 * help from far away, do I have to buy the hardware — and the last two are
 * the ones that decide whether to trust it at all: what happens to our
 * photographs if we stop, and is this even right for us.
 *
 * THE AI QUESTION (26 Sep 2026) answers "no" first, because that is true:
 * no language model runs in the product. Only then does it say what we are
 * researching, that it would be offered separately, and that the number and
 * the card always keep working. It links to /research and nowhere that sells.
 *
 * THE LAST ANSWER DOES NOT PROMISE. "Cognitive abilities differ from person
 * to person… we talk it through with you first" is the only honest answer a
 * product for dementia can give, and it is the one a family checking on a
 * parent most deserves.
 */

const COPY = {
  fr: {
    eyebrow: "LES QUESTIONS DES FAMILLES",
    title: "Ce que les gens veulent savoir d’abord.",
    items: [
      {
        q: "La personne a-t-elle besoin d’un smartphone ?",
        a: "Non. Recall vit sur l’écran de la maison et fonctionne avec des commandes physiques simples.",
      },
      {
        q: "Doit-elle apprendre une nouvelle application ?",
        a: "Non. Son côté reste volontairement simple : un numéro ouvre un canal.",
      },
      {
        q: "Puis-je ajouter des choses si je n’habite pas à côté ?",
        a: "Oui. Les membres de la famille contribuent à distance, et plusieurs personnes peuvent alimenter une même archive.",
      },
      {
        q: "Dois-je acheter le Recall Dock ?",
        a: "Non. Vous pouvez commencer sur une télévision que vous avez déjà. Le Dock ajoute un clavier et un lecteur de cartes pour ceux qui en profitent.",
      },
      {
        q: "Recall utilise-t-il l’intelligence artificielle ?",
        a: "Non. Aujourd’hui, rien dans Recall n’écoute, ne parle ni ne génère du côté de la personne, et aucun modèle de langage ne tourne dans le produit. C’est son archive et un écran familier. Avec des partenaires de soins, nous étudions si l’archive pourrait un jour répondre à une question, au rythme de la personne. Si cela arrive un jour dans un foyer, ce sera proposé séparément, cela dira à chaque fois que c’est un ordinateur, et le numéro et la carte fonctionneront toujours.",
        more: "Ce que nous étudions",
      },
      {
        q: "Qu’advient-il de nos photographies si nous arrêtons ?",
        a: "Elles sont à vous. Vous pouvez exporter toute l’archive à tout moment, et nous supprimons notre copie quand vous le demandez.",
      },
      {
        q: "Recall convient-il à tous les stades de la démence ?",
        a: "Les capacités cognitives diffèrent d’une personne à l’autre. Recall est conçu pour réduire les exigences de navigation, mais la bonne configuration dépend de la personne. Nous en parlons avec vous d’abord.",
      },
    ],
  },
  nl: {
    eyebrow: "VRAGEN DIE FAMILIES STELLEN",
    title: "Wat mensen eerst willen weten.",
    items: [
      {
        q: "Heeft de persoon een smartphone nodig?",
        a: "Nee. Recall leeft op het scherm thuis en werkt met eenvoudige fysieke bediening.",
      },
      {
        q: "Moeten ze een nieuwe app leren?",
        a: "Nee. Hun kant wordt bewust eenvoudig gehouden: een nummer opent een kanaal.",
      },
      {
        q: "Kan ik dingen toevoegen als ik niet in de buurt woon?",
        a: "Ja. Familieleden dragen van op afstand bij, en meerdere mensen kunnen aan één archief werken.",
      },
      {
        q: "Moet ik de Recall Dock kopen?",
        a: "Nee. Je kunt starten op een televisie die je al hebt. De Dock voegt een toetsenbord en kaartlezer toe voor wie daar baat bij heeft.",
      },
      {
        q: "Gebruikt Recall artificiële intelligentie?",
        a: "Nee. Niets in Recall luistert, spreekt of genereert vandaag aan de kant van de persoon, en er draait geen taalmodel in het product. Het is hun archief en een vertrouwd scherm. Samen met zorgpartners onderzoeken we of het archief ooit een vraag zou kunnen beantwoorden, op het eigen tempo van de persoon. Als dat ooit bij iemand thuis komt, wordt het apart aangeboden, zegt het telkens dat het een computer is, en blijven het nummer en de kaart altijd werken.",
        more: "Wat we onderzoeken",
      },
      {
        q: "Wat gebeurt er met onze foto’s als we stoppen?",
        a: "Ze zijn van jou. Je kunt het hele archief op elk moment exporteren, en wij verwijderen onze kopie wanneer je het vraagt.",
      },
      {
        q: "Is Recall geschikt voor elk stadium van dementie?",
        a: "Cognitieve mogelijkheden verschillen van persoon tot persoon. Recall is ontworpen om navigatie-eisen te verlagen, maar de juiste opstelling hangt af van de persoon. We bespreken het eerst met jou.",
      },
    ],
  },
  en: {
    eyebrow: "QUESTIONS FAMILIES ASK",
    title: "The things people want to know first.",
    items: [
      {
        q: "Does the person need a smartphone?",
        a: "No. Recall lives on the screen at home and works with simple physical controls.",
      },
      {
        q: "Do they need to learn a new app?",
        a: "No. Their side is deliberately kept simple: a number opens a channel.",
      },
      {
        q: "Can I add things when I don’t live nearby?",
        a: "Yes. Family members contribute remotely, and several people can contribute to one archive.",
      },
      {
        q: "Do I need to buy the Recall Dock?",
        a: "No. You can start on a television you already have. The Dock adds a keyboard and card reader for people who benefit from them.",
      },
      {
        q: "Does Recall use artificial intelligence?",
        a: "No. Nothing in Recall today listens, speaks or generates on the person’s side, and no language model runs in the product. It is their archive and a familiar screen. With care partners, we are researching whether the archive could one day answer a question, at the person’s own pace. If that ever reaches a home, it will be offered separately, it will say every time that it is a computer, and the number and the card will always still work.",
        more: "What we are researching",
      },
      {
        q: "What happens to our photographs if we stop?",
        a: "They are yours. You can export the whole archive at any time, and we delete our copy when you ask.",
      },
      {
        q: "Is Recall suitable for every stage of dementia?",
        a: "Cognitive abilities differ from person to person. Recall is designed to reduce navigation demands, but the right setup depends on the individual. We talk it through with you first.",
      },
    ],
  },
} as const;

export function Questions() {
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section className="s-wrap s-rule" style={{ paddingTop: 90, paddingBottom: 90 }}>
      <div className="s-eyebrow">{t.eyebrow}</div>
      <h2 className="s-h2" style={{ maxWidth: "18ch" }}>
        {t.title}
      </h2>

      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
          gap: "clamp(24px,3vw,40px) clamp(32px,4vw,64px)",
          marginTop: "clamp(36px,4vw,56px)",
        }}
      >
        {t.items.map((item) => (
          <div key={item.q} style={{ borderTop: "1px solid rgba(var(--s-ink),0.18)", paddingTop: 18 }}>
            <h3
              style={{
                margin: 0,
                font: "600 17px/1.35 Archivo, sans-serif",
                letterSpacing: "-.005em",
                textWrap: "pretty",
              }}
            >
              {item.q}
            </h3>
            <p
              style={{
                margin: "10px 0 0",
                font: "400 15px/1.65 Roboto, sans-serif",
                color: "rgba(var(--s-ink),0.72)",
                maxWidth: "44ch",
                textWrap: "pretty",
              }}
            >
              {item.a}
              {"more" in item ? (
                <>
                  {" "}
                  <Link to="/research" className="underline underline-offset-4" style={{ color: "rgba(var(--s-ink),0.9)" }}>
                    {item.more}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
