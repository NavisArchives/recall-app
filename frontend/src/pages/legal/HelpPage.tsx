import { useLang } from "@/lib/publicLang";
import { SELLER } from "@/lib/seller";
import { PublicPage, Clause } from "@/components/public/PublicPage";

const COPY = {
  fr: {
    eyebrow: "AIDE",
    title: "Une personne lit cette boîte mail.",
    lead: "Recall est volontairement petit. Il n’y a pas de système de tickets ni de chatbot — vous écrivez, et quelqu’un qui a construit Recall vous répond, en un jour ouvrable.",
    back: "Retour",
    write: "Écrivez-nous",
    writeBody: "Pour tout : un écran qui est devenu noir, une carte qui n’est pas arrivée, un mot de passe que vous avez perdu, une question avant de vous inscrire.",
    signin: "Se connecter",
    signinBody: "Vous vous connectez avec l’e-mail et le mot de passe de la famille sur recall.family/login. Si le mot de passe est perdu, utilisez « Oublié ? » sur cette page — un lien arrive à l’adresse e-mail de la famille et fonctionne une seule fois, pendant 30 minutes.",
    screen: "Son écran",
    screenBody: "L’écran continue de défiler tout seul. S’il affiche une page de connexion après une coupure de courant ou un déménagement, un administrateur le réassocie depuis Paramètres → Écrans dans l’espace famille.",
    cards: "Cartes postales et cartes",
    cardsBody: "Chaque carte est imprimée et postée à la main. Cartes → la carte → sa chronologie montre où elle se trouve. Une carte qui n’est pas arrivée après dix jours ouvrables : écrivez-nous, et elle est réimprimée sans frais.",
  },
  en: {
    eyebrow: "HELP",
    title: "A person reads this inbox.",
    lead: "Recall is small on purpose. There is no ticket system and no chatbot — you write, and somebody who built this answers, within one working day.",
    back: "Back",
    write: "Write to us",
    writeBody: "For anything: a screen that went dark, a card that did not arrive, a password you lost, a question before you sign up.",
    signin: "Signing in",
    signinBody: "You sign in with the family email and password on recall.family/login. If the password is gone, use “Forgotten it?” on that page — a link comes to the family email and works once for 30 minutes.",
    screen: "Her screen",
    screenBody: "The screen keeps playing on its own. If it shows a sign-in page after a power cut or a move, an admin pairs it again from Settings → Screens in the workspace.",
    cards: "Postcards and cards",
    cardsBody: "Every card is printed and posted by hand. Cards → the card → its timeline shows where it is. A card that did not arrive within ten working days: write, and it is reprinted at no cost.",
  },
  nl: {
    eyebrow: "HULP",
    title: "Een mens leest deze mailbox.",
    lead: "Recall is bewust klein. Er is geen ticketsysteem en geen chatbot — je schrijft, en iemand die dit gebouwd heeft antwoordt, binnen één werkdag.",
    back: "Terug",
    write: "Schrijf ons",
    writeBody: "Voor alles: een scherm dat zwart ging, een kaart die niet toekwam, een wachtwoord dat je kwijt bent, een vraag vóór je inschrijft.",
    signin: "Inloggen",
    signinBody: "Je logt in met het familie-e-mailadres en wachtwoord op recall.family/login. Wachtwoord kwijt? Gebruik “Vergeten?” op die pagina — er komt een link naar het familieadres die één keer werkt, 30 minuten lang.",
    screen: "Haar scherm",
    screenBody: "Het scherm speelt vanzelf verder. Toont het na een stroomonderbreking of een verhuis een inlogpagina, dan koppelt een beheerder het opnieuw via Instellingen → Schermen in de familieruimte.",
    cards: "Kaarten",
    cardsBody: "Elke kaart wordt met de hand gedrukt en gepost. Kaarten → de kaart → haar tijdlijn toont waar ze is. Een kaart die na tien werkdagen niet toekwam: schrijf, en ze wordt gratis opnieuw gedrukt.",
  },
} as const;

/** recall.family/help — the address the sign-in page has pointed at since M111. */
export function HelpPage() {
  const [lang] = useLang();
  const t = COPY[lang];
  return (
    <PublicPage eyebrow={t.eyebrow} title={t.title} lead={t.lead} back={t.back}>
      <Clause title={t.write}>
        <p>{t.writeBody}</p>
        <p>
          <a
            href={`mailto:${SELLER.email}`}
            className="inline-block rounded-[12px] bg-accent px-6 py-[13px] text-[15px] font-medium leading-none text-accent-foreground transition-opacity hover:opacity-90"
          >
            {SELLER.email}
          </a>
        </p>
      </Clause>
      <Clause title={t.signin}><p>{t.signinBody}</p></Clause>
      <Clause title={t.screen}><p>{t.screenBody}</p></Clause>
      <Clause title={t.cards}><p>{t.cardsBody}</p></Clause>
    </PublicPage>
  );
}
