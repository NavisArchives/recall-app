import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { LANGS, useLang, type Lang } from "@/lib/publicLang";
import { OnboardingChrome, SecondaryButton } from "@/components/onboarding/bits";

/**
 * Asking to be let in (M44), as the owner drew the flow on 17 Sep 2026.
 *
 * One page, one coherent walk: who you are, who it is for, which of the two
 * configurations you want (Recall on your own screen, or the Recall Dock —
 * "a media hub with a keyboard and a connected-card reader"), and how you
 * would like to pay (€25 a month, or €275 a year with one month free). Then
 * a person gets back to you and sends an invoice by hand; nothing is charged
 * here, and the page says so.
 *
 * Public, so strangers write to it, and it answers the same way whatever
 * happens behind it — new address, address that already asked, address that
 * already belongs to a family. Anything else would make this form a
 * membership oracle (M19). So there is one outcome on screen, and it is
 * honest about what it promises: that the message arrived, not that an
 * invitation will follow.
 */

type Tier = "digital" | "dock";
type Period = "monthly" | "yearly";

const COPY = {
  fr: {
    eyebrow: "INVITATION",
    title: "Demander une invitation",
    lead: "Quatre choses, et une personne les lit. Rien n’est facturé sur cette page.",
    yourEmail: "VOTRE E-MAIL",
    yourName: "VOTRE NOM",
    relationship: "VOUS ÊTES",
    relationshipHint: "Sa fille, son fils, son aidant…",
    language: "RÉPONDRE EN",
    forWhom: "POUR QUI EST-CE",
    forWhomHint: "Une phrase suffit — de qui il s’agit, et où vous habitez.",
    which: "QUEL RECALL",
    tiers: {
      digital: { name: "Recall", line: "Sur l’écran qu’ils ont déjà. Rien à installer.", price: "€75" },
      dock: { name: "Recall Dock", line: "Un média-hub avec un clavier et un lecteur de cartes connectées, l’appareil compris. Précommande : facturé quand il sera prêt à être expédié.", price: "€490" },
    },
    setupLabel: "installation unique",
    how: "COMMENT VOUS SOUHAITEZ PAYER",
    periods: {
      monthly: { name: "Mensuel", line: "€25 par mois, TVA comprise" },
      yearly: { name: "Annuel", line: "€275 par an — un mois gratuit" },
    },
    send: "Envoyer",
    sending: "Envoi…",
    privacy: "Nous gardons ce que vous envoyez pour y répondre, et pour rien d’autre. Lisez la",
    privacyLink: "politique de confidentialité",
    thanks: "Merci",
    arrived: "Votre demande est bien arrivée. Recall est volontairement petit et les invitations partent lentement — une personne lira ceci et vous répondra à cette adresse, avec une facture si cela vous convient.",
    back: "Retour",
    failed: "Cela n’a pas pu être envoyé.",
  },
  en: {
    eyebrow: "INVITATION",
    title: "Ask for an invitation",
    lead: "Four things, and a person reads them. Nothing is charged on this page.",
    yourEmail: "YOUR EMAIL",
    yourName: "YOUR NAME",
    relationship: "YOU ARE",
    relationshipHint: "Her daughter, his son, their carer…",
    language: "REPLY IN",
    forWhom: "WHO IS IT FOR",
    forWhomHint: "A sentence is plenty — who they are, and where you are.",
    which: "WHICH RECALL",
    tiers: {
      digital: { name: "Recall", line: "On the screen they already have. Nothing to install.", price: "€75" },
      dock: { name: "Recall Dock", line: "A media hub with a keyboard and a connected-card reader, the device included. Pre-order: invoiced when it is ready to ship.", price: "€490" },
    },
    setupLabel: "one-time setup",
    how: "HOW YOU WOULD LIKE TO PAY",
    periods: {
      monthly: { name: "Monthly", line: "€25 a month, incl. VAT" },
      yearly: { name: "Yearly", line: "€275 a year — one month free" },
    },
    send: "Send",
    sending: "Sending…",
    privacy: "We keep what you send to answer it, and for nothing else. Read the",
    privacyLink: "privacy policy",
    thanks: "Thank you",
    arrived: "Your request has arrived. Recall is small on purpose and invitations go out slowly — a person will read this and get back to you at this address, with an invoice if it is right for you.",
    back: "Back",
    failed: "That could not be sent.",
  },
  nl: {
    eyebrow: "UITNODIGING",
    title: "Vraag een uitnodiging aan",
    lead: "Vier dingen, en een mens leest ze. Op deze pagina wordt niets aangerekend.",
    yourEmail: "JE E-MAIL",
    yourName: "JE NAAM",
    relationship: "JIJ BENT",
    relationshipHint: "Haar dochter, zijn zoon, hun zorgverlener…",
    language: "ANTWOORD IN",
    forWhom: "VOOR WIE IS HET",
    forWhomHint: "Eén zin volstaat — wie ze zijn, en waar jullie wonen.",
    which: "WELKE RECALL",
    tiers: {
      digital: { name: "Recall", line: "Op het scherm dat ze al hebben. Niets te installeren.", price: "€75" },
      dock: { name: "Recall Dock", line: "Een mediahub met klavier en lezer voor verbonden kaarten, het toestel inbegrepen. Vooraf bestellen: gefactureerd wanneer het verzendklaar is.", price: "€490" },
    },
    setupLabel: "eenmalige installatie",
    how: "HOE JE WILT BETALEN",
    periods: {
      monthly: { name: "Maandelijks", line: "€25 per maand, incl. btw" },
      yearly: { name: "Jaarlijks", line: "€275 per jaar — één maand gratis" },
    },
    send: "Versturen",
    sending: "Bezig…",
    privacy: "We bewaren wat je stuurt om te antwoorden, en voor niets anders. Lees de",
    privacyLink: "privacyverklaring",
    thanks: "Bedankt",
    arrived: "Je aanvraag is toegekomen. Recall is bewust klein en uitnodigingen gaan traag uit — een mens leest dit en antwoordt je op dit adres, met een factuur als het bij jullie past.",
    back: "Terug",
    failed: "Dat kon niet verstuurd worden.",
  },
} as const;

/* The page's own palette — public, so it is written down, not inherited. */
const INK = "#14130f";
const MUTED = "rgba(20,19,15,.62)";
const FAINT = "rgba(20,19,15,.5)";
const LINE = "rgba(20,19,15,.18)";
const RUST = "#c13b22";

const CAPS = "block font-mono text-[10px] tracking-[0.16em]";
const FIELD =
  "mt-2 h-[52px] w-full rounded-[10px] border bg-transparent px-[18px] text-[16px] outline-none transition-colors";
const CHOICE =
  "flex cursor-pointer items-start gap-3 rounded-[14px] border px-3.5 py-2.5 text-left transition-colors";

/* The rule takes the accent while you are in the field, and gives it back. */
const ruleOn = (e: { currentTarget: { style: CSSStyleDeclaration } }) => {
  e.currentTarget.style.borderColor = "var(--accent)";
};
const ruleOff = (e: { currentTarget: { style: CSSStyleDeclaration } }) => {
  e.currentTarget.style.borderColor = "rgba(var(--ink),.22)";
};

export function RequestInvitePage() {
  const navigate = useNavigate();
  const [lang] = useLang();
  const t = COPY[lang];
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [relationship, setRelationship] = useState("");
  /*
    The language to write back in, prefilled from the one they are reading.
    That is the best evidence there is — better than guessing from an email
    address, which is how a Walloon family gets a Dutch letter — and they can
    change it in one press.
  */
  const [replyIn, setReplyIn] = useState<Lang>(lang);
  const [tier, setTier] = useState<Tier>("digital");
  const [period, setPeriod] = useState<Period>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/onboarding/founding/request", {
        email: email.trim(),
        name: name.trim(),
        note: note.trim(),
        interested_tier: tier,
        billing_period: period,
        relationship: relationship.trim(),
        preferred_language: replyIn,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <OnboardingChrome tone="paper">
        <div className="w-[460px] max-w-full text-center">
          <h1
            style={{
              margin: 0,
              font: "600 clamp(24px, 2.6vw, 32px)/1.16 Archivo, sans-serif",
              letterSpacing: "-.01em",
              color: INK,
            }}
          >
            {t.thanks}
            <span className="s-dot" />
          </h1>
          <p className="mt-3 text-[15px] leading-[1.6]" style={{ color: MUTED }}>{t.arrived}</p>
          <div className="mt-7 flex justify-center">
            <SecondaryButton onClick={() => navigate("/welcome")}>{t.back}</SecondaryButton>
          </div>
        </div>
      </OnboardingChrome>
    );
  }

  return (
    <OnboardingChrome tone="paper" back={t.back}>
      <div className="flex w-[880px] max-w-full flex-col gap-3">
        {/*
          The page opens the way every section of the landing page does: a red
          mono eyebrow, then the heading in Archivo. It was Roboto bold with
          no eyebrow, which read as a form from a different product once the
          front page was redrawn.
        */}
        <div className="text-center">
          <div className="s-eyebrow">{t.eyebrow}</div>
          {/* The full stop is the wordmark's, and the title earns it: this is
              the one sentence on the page that is a statement rather than a
              field. */}
          <h1
            className="mt-3"
            style={{
              margin: "10px 0 0",
              font: "600 clamp(24px, 2.3vw, 30px)/1.14 Archivo, sans-serif",
              letterSpacing: "-.01em",
              color: INK,
            }}
          >
            {t.title}
            <span className="s-dot" />
          </h1>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[14px] leading-[1.45]" style={{ color: MUTED }}>
            {t.lead}
          </p>
        </div>

        {/* One card holding the whole ask. On the bare ground the four
            sections read as four separate things; inside one surface they
            read as one form with four parts. */}
        <form
          onSubmit={submit}
          /*
            Two columns, and the reason is the height rather than the look:
            stacked, this page was 195px taller than an 800px laptop and the
            owner wanted no scroll. Side by side the page is as tall as its
            taller half instead of the sum of both. Below `md` it stacks
            again — a phone scrolls, and that is what a phone is for.
          */
          className="s-card s-card--white grid grid-cols-1 gap-x-8 gap-y-3.5 p-4 md:grid-cols-2 md:p-5"
        >
          {/* Left: the three things they write. */}
          <div className="flex flex-col gap-3.5">
            <label>
              <span className={CAPS} style={{ color: FAINT }}>{t.yourEmail}</span>
              <input
                type="email"
                required
                autoFocus
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={ruleOn}
                onBlur={ruleOff}
                className={FIELD}
                style={{ borderColor: LINE, color: INK }}
              />
            </label>

            <label>
              <span className={CAPS} style={{ color: FAINT }}>{t.yourName}</span>
              <input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                onFocus={ruleOn}
                onBlur={ruleOff}
                className={FIELD}
                style={{ borderColor: LINE, color: INK }}
              />
            </label>

            <label>
              <span className={CAPS} style={{ color: FAINT }}>{t.relationship}</span>
              <input
                value={relationship}
                maxLength={80}
                placeholder={t.relationshipHint}
                onChange={(e) => setRelationship(e.target.value)}
                onFocus={ruleOn}
                onBlur={ruleOff}
                className={`${FIELD} placeholder:italic`}
                style={{ borderColor: LINE, color: INK }}
              />
            </label>

            <fieldset>
              <legend className={`${CAPS} mb-2`} style={{ color: FAINT }}>{t.language}</legend>
              {/* Three presses wide, because there are three. A select would
                  hide two of them behind a tap for no gain. */}
              <div className="flex gap-2">
                {LANGS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setReplyIn(l)}
                    aria-pressed={replyIn === l}
                    className="flex-1 rounded-full border py-2.5 text-center font-mono text-[12px] uppercase tracking-[0.12em] transition-colors"
                    /* The same mark the page's own language switch wears —
                       a filled near-black pill — so the two reads of "which
                       language" look like one idea rather than two. */
                    style={
                      replyIn === l
                        ? { borderColor: INK, background: INK, color: "#f7f3eb" }
                        : { borderColor: LINE, color: MUTED }
                    }
                  >
                    {l}
                  </button>
                ))}
              </div>
            </fieldset>

          <label>
            <span className={CAPS} style={{ color: FAINT }}>{t.forWhom}</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.forWhomHint}
              onFocus={ruleOn}
              onBlur={ruleOff}
              className={`${FIELD} resize-none placeholder:italic placeholder:text-[color:var(--fg-hint)]`}
              style={{ borderColor: LINE, color: INK }}
            />
            </label>
          </div>

          {/* Right: the two things they choose, and the send. Recorded with
              the request so the owner's doorstep shows it and the first
              invoice needs no second conversation. */}
          <div className="flex flex-col gap-3.5">
          <fieldset>
            <legend className={`${CAPS} mb-2`} style={{ color: FAINT }}>{t.which}</legend>
            <div className="flex flex-col gap-2.5">
            {(["digital", "dock"] as Tier[]).map((k) => (
              <label
                key={k}
                className={CHOICE}
                style={{
                  borderColor: tier === k ? RUST : LINE,
                  background: tier === k ? "rgba(193,59,34,.05)" : undefined,
                }}
              >
                <input type="radio" name="tier" className="mt-1.5" checked={tier === k} onChange={() => setTier(k)} />
                <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[15.5px] font-medium">{t.tiers[k].name}</span>
                    <span className="mt-1 block text-[12.5px] leading-[1.45]" style={{ color: MUTED }}>{t.tiers[k].line}</span>
                  </span>
                  {/* The number that actually differs between the two, beside
                      the thing it is the price of rather than in a sentence
                      underneath the pair. */}
                  <span className="flex-none text-right">
                    <span className="block text-[20px] font-light leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {t.tiers[k].price}
                    </span>
                    <span className="mt-1.5 block font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>
                      {t.setupLabel}
                    </span>
                  </span>
                </span>
              </label>
            ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={`${CAPS} mb-2`} style={{ color: FAINT }}>{t.how}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(["monthly", "yearly"] as Period[]).map((k) => (
                <label
                  key={k}
                  className={CHOICE}
                  style={{
                    borderColor: period === k ? RUST : LINE,
                    background: period === k ? "rgba(193,59,34,.05)" : undefined,
                  }}
                >
                  <input type="radio" name="period" className="mt-1.5" checked={period === k} onChange={() => setPeriod(k)} />
                  <span>
                    <span className="block text-[15.5px] font-medium">{t.periods[k].name}</span>
                    <span className="mt-1 block text-[13px] leading-[1.5]" style={{ color: MUTED }}>{t.periods[k].line}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Only when there is one. A reserved line is twenty pixels of
              nothing on a page that has to fit a screen. */}
          {error && (
            <p role="alert" className="text-sm" style={{ color: "#a6301b" }}>
              {error}
            </p>
          )}

          {/* The same button the front page invites you with, so pressing
              through from there lands on the same object. */}
          <button
            type="submit"
            disabled={busy}
            className="s-btn s-btn--red s-btn--block disabled:opacity-40"
          >
            {busy ? t.sending : t.send}
          </button>
          <p className="text-center text-[12px] leading-[1.6]" style={{ color: FAINT }}>
            {t.privacy}{" "}
            <Link to="/privacy" className="underline underline-offset-2" style={{ color: MUTED }}>{t.privacyLink}</Link>.
          </p>
          </div>
        </form>
      </div>
    </OnboardingChrome>
  );
}
