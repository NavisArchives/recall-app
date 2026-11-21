import { Link } from "react-router-dom";
import { useLang } from "@/lib/publicLang";
import { SELLER, sellerIsRegistered } from "@/lib/seller";
import { PublicPage, Clause } from "@/components/public/PublicPage";

/**
 * The terms (Belgian Code of Economic Law, Book VI — distance and off-premises
 * contracts with consumers), launch sweep.
 *
 * Every number in here is a commitment the owner was handed as a default on
 * 16 Sep 2026: prices incl. 21% VAT, a 30-day guarantee, monthly cancellation,
 * the bereavement promise (stop the same day, export within 14 days, keep 12
 * months). Change a number here and in the pricing page together.
 */

const UPDATED = { fr: "16 septembre 2026", en: "16 September 2026", nl: "16 september 2026" };

export function TermsPage() {
  const [lang] = useLang();
  const seller = sellerIsRegistered()
    ? `${SELLER.legalName}${SELLER.registration ? ` (${SELLER.registration})` : ""}${SELLER.vat ? `, ${SELLER.vat}` : ""}, ${SELLER.address}`
    : null;

  if (lang === "fr") {
    return (
      <PublicPage
        eyebrow="CONDITIONS"
        title="Ce que nous promettons, et ce que nous vous demandons."
        lead={`Dernière mise à jour le ${UPDATED.fr}. Court, en langage clair, et contraignant pour nous deux.`}
        back="Retour"
      >
        <Clause n="01" title="Qui vend">
          <p>
            Recall est géré depuis la {SELLER.regionFr}. {seller ? `Vendeur : ${seller}. ` : ""}
            E-mail : <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>
            {SELLER.phone ? `, téléphone ${SELLER.phone}` : ""}.
            {!seller && " Les coordonnées du vendeur enregistré (nom, numéro d’entreprise, numéro de TVA, adresse) apparaissent ici avant la première facture."}
          </p>
        </Clause>

        <Clause n="02" title="Ce qu’est Recall">
          <p>
            Des archives personnelles pour une personne qui vit avec une perte de mémoire : ses photos, ses films et ses
            récits enregistrés, rangés dans des canaux portant un numéro, montrés sur un écran chez elle et ouverts avec un
            numéro sur la télécommande ou une carte posée sur le lecteur. La famille construit et gère les archives depuis
            n’importe quel téléphone ou ordinateur portable. Chaque mois, une carte imprimée arrive par la poste, à son nom.
          </p>
          <p>
            Recall n’est pas un dispositif médical, ni un traitement, ni un substitut aux soins ou à la surveillance. Ce
            sont des archives.
          </p>
        </Clause>

        <Clause n="03" title="Invitation et compte">
          <p>
            Recall est uniquement sur invitation. La personne qui crée des archives est majeure, gère le compte de la famille
            et déclare, au moment de la création, qu’elle-même consent à ce que sa vie soit montrée sur son écran — ou que
            la personne qui peut légalement décider pour elle y consent. Aucune archive n’est activée sans cette déclaration.
            Voir la{" "}
            <Link to="/privacy" className="underline underline-offset-2">politique de confidentialité</Link>.
          </p>
        </Clause>

        <Clause n="04" title="Prix et paiement">
          <p>
            Tous les prix sur <Link to="/pricing" className="underline underline-offset-2">recall.family/pricing</Link> sont
            des prix totaux en euros, <strong>TVA de 21% comprise</strong>. Des frais d’installation uniques sont dus au
            début : <strong>€75</strong> pour Recall, <strong>€490</strong> pour le Recall Dock, l’appareil lui-même étant
            compris. Ensuite, les deux configurations coûtent €25 par mois, ou €275 par an avec un mois gratuit. Pas de frais
            cachés.
          </p>
          <p>
            Vous payez par facture, par virement bancaire ; aucune donnée de carte bancaire n’est demandée sur ce site. Les
            archives sont activées après réception du premier paiement ; le prix mensuel court à partir de ce jour-là. Le
            matériel qui n’est pas encore disponible n’est facturé que lorsqu’il est prêt à être expédié, avec une date de
            livraison concrète.
          </p>
          <p>
            Si une facture reste impayée plus de 14 jours après son échéance, nous mettons l’espace de la famille en pause
            jusqu’à ce qu’elle soit payée. Son écran, lui, continue toujours de jouer.
          </p>
        </Clause>

        <Clause n="05" title="Droit de rétractation (14 jours) et notre garantie (30 jours)">
          <p>
            En tant que consommateur, vous avez le droit légal de renoncer à l’achat dans les 14 jours sans devoir donner de
            motif : pour le service, à partir du jour du contrat ; pour le matériel, à partir du jour où vous le recevez.
            Faites-le-nous savoir par e-mail, ou au moyen du formulaire type en bas de page. Si vous nous demandez d’ouvrir
            l’espace de la famille immédiatement, vous acceptez que le service commence pendant ces 14 jours ; si vous vous
            rétractez malgré tout, vous ne payez que les jours pendant lesquels il a été ouvert.
          </p>
          <p>
            En plus de cela : <strong>dans les 30 jours qui suivent votre premier paiement</strong>, vous pouvez arrêter pour
            quelque raison que ce soit et tout vous est remboursé, y compris les frais uniques. Le matériel est alors renvoyé
            sans dommage ; les frais de renvoi sont à votre charge. Les archives restent les vôtres : vous les recevez en
            téléchargement.
          </p>
        </Clause>

        <Clause n="06" title="Résiliable chaque mois">
          <p>
            Il n’y a pas de durée minimale. Vous pouvez résilier chaque mois, par e-mail ; l’abonnement se termine à la fin
            du mois payé. Jusque-là, tout continue de fonctionner.
          </p>
        </Clause>

        <Clause n="07" title="En cas de décès">
          <p>
            Dites-le-nous. La facturation s’arrête le jour même — pas de préavis, pas de dernier mois. Dans les 14 jours,
            vous recevez l’ensemble des archives en téléchargement (photos, films, récits, textes). Nous les conservons
            12 mois, puis elles sont supprimées, sauf si vous demandez autre chose.
          </p>
        </Clause>

        <Clause n="08" title="Votre contenu">
          <p>
            Les photos, les films et les récits restent les vôtres. Vous nous donnez uniquement le droit de les conserver et
            de les montrer comme le service l’exige. Vous veillez à avoir le droit de les partager — y compris pour ce qui
            concerne les autres personnes présentes sur les photos. Ce qui est illicite, nous le retirons après signalement.
          </p>
        </Clause>

        <Clause n="09" title="Matériel">
          <p>
            Ce qui arrive avec chaque configuration figure sur la page des prix. Le matériel bénéficie de la garantie légale
            de deux ans. Un appareil défectueux est réparé ou remplacé ; écrivez-nous. Un écran que nous fournissons conserve
            les archives sur l’appareil lui-même — traitez-le comme un album photo qui se trouve dans la maison.
          </p>
        </Clause>

        <Clause n="10" title="Disponibilité et responsabilité">
          <p>
            Nous faisons ce qui est raisonnablement possible pour que Recall fonctionne jour et nuit et pour que les
            interruptions restent courtes, mais un service qui passe par internet n’est jamais ininterrompu. Nous ne sommes
            pas responsables des dommages qui découlent de l’utilisation des archives comme autre chose que des archives.
            Dans la mesure où la loi le permet, notre responsabilité est limitée à ce que vous nous avez payé au cours des
            12 derniers mois. Rien ici ne limite vos droits légaux en tant que consommateur.
          </p>
        </Clause>

        <Clause n="11" title="Modifications">
          <p>
            Si ces conditions ou les prix changent, nous prévenons l’administrateur des archives par e-mail au moins 30 jours
            à l’avance. Si vous n’êtes pas d’accord, vous pouvez résilier avant que la modification n’entre en vigueur.
          </p>
        </Clause>

        <Clause n="12" title="Droit, litiges, plaintes">
          <p>
            Le droit belge est applicable. Un litige relève du tribunal de votre lieu de résidence. Nous parlons d’abord :
            écrivez à <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>. Si nous
            ne trouvons pas de solution ensemble, vous pouvez vous adresser au Service de Médiation pour le Consommateur (
            {/* The French-language site of the same body. Every branch links
                its own language's domain; this one pointed at the Dutch site,
                which was also the only Dutch string a French reader met. */}
            <a href="https://mediationconsommateur.be" className="underline underline-offset-2">mediationconsommateur.be</a>) ou
            à la plateforme européenne de règlement en ligne des litiges (
            <a href="https://ec.europa.eu/odr" className="underline underline-offset-2">ec.europa.eu/odr</a>).
          </p>
        </Clause>

        <Clause title="Modèle de formulaire de rétractation">
          <p className="whitespace-pre-line font-mono text-[13px] leading-[1.7]">
            {`À ${SELLER.tradeName}${seller ? ` (${seller})` : ""}, ${SELLER.email} :

Je/Nous (*) vous notifie/notifions (*) par la présente ma/notre (*)
rétractation du contrat portant sur la vente du bien suivant (*) / la
prestation du service suivant (*) :
— commandé le (*) / reçu le (*) :
— nom du/des consommateur(s) :
— adresse du/des consommateur(s) :
— signature (uniquement en cas de notification sur papier) :
— date :

(*) rayez la mention inutile`}
          </p>
        </Clause>
      </PublicPage>
    );
  }

  if (lang === "nl") {
    return (
      <PublicPage
        eyebrow="VOORWAARDEN"
        title="Wat we beloven, en wat we van jullie vragen."
        lead={`Laatst bijgewerkt op ${UPDATED.nl}. Kort, in gewone taal, en bindend voor ons allebei.`}
        back="Terug"
      >
        <Clause n="01" title="Wie verkoopt">
          <p>
            Recall wordt gerund vanuit {SELLER.regionNl}. {seller ? `Verkoper: ${seller}. ` : ""}
            E-mail: <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>
            {SELLER.phone ? `, telefoon ${SELLER.phone}` : ""}.
            {!seller && " De geregistreerde verkopersgegevens (naam, ondernemingsnummer, btw-nummer, adres) verschijnen hier vóór de eerste factuur."}
          </p>
        </Clause>

        <Clause n="02" title="Wat Recall is">
          <p>
            Een persoonlijk geheugenarchief voor iemand die met geheugenverlies leeft: haar foto's, films en ingesproken
            verhalen, geordend in kanalen met een nummer, getoond op een scherm bij haar thuis en geopend met een nummer op
            de afstandsbediening of een kaart die op de lezer wordt gelegd. De familie bouwt en beheert het archief vanop
            elke telefoon of laptop. Elke maand komt er een gedrukte kaart met de post, gericht aan haar.
          </p>
          <p>
            Recall is geen medisch hulpmiddel, geen behandeling en geen vervanging voor zorg of toezicht. Het is een
            archief.
          </p>
        </Clause>

        <Clause n="03" title="Uitnodiging en account">
          <p>
            Recall is enkel op uitnodiging. Wie een archief aanmaakt, is meerderjarig, beheert de familieaccount en verklaart
            bij het aanmaken dat zij zelf toestemt met het tonen van haar leven op haar scherm — of dat wie wettelijk voor haar
            mag beslissen dat doet. Zonder die verklaring wordt geen archief geactiveerd. Zie de{" "}
            <Link to="/privacy" className="underline underline-offset-2">privacyverklaring</Link>.
          </p>
        </Clause>

        <Clause n="04" title="Prijzen en betaling">
          <p>
            Alle prijzen op <Link to="/pricing" className="underline underline-offset-2">recall.family/pricing</Link> zijn
            totaalprijzen in euro, <strong>inclusief 21% btw</strong>. Er is een eenmalige installatiekost bij de start:
            <strong>€75</strong> voor Recall, <strong>€490</strong> voor de Recall Dock, waarbij het toestel zelf inbegrepen
            is. Daarna kosten beide configuraties €25 per maand, of €275 per jaar met één maand gratis. Geen verborgen kosten.
          </p>
          <p>
            Je betaalt per factuur, via overschrijving; er worden op deze site geen kaartgegevens gevraagd. Het archief wordt
            geactiveerd na ontvangst van de eerste betaling; de maandprijs loopt vanaf die dag. Apparatuur die nog niet
            beschikbaar is, wordt pas gefactureerd wanneer ze verzendklaar is, met een concrete leverdatum.
          </p>
          <p>
            Blijft een factuur meer dan 14 dagen na de vervaldag onbetaald, dan pauzeren we de familieruimte tot ze betaald
            is. Haar scherm blijft altijd spelen.
          </p>
        </Clause>

        <Clause n="05" title="Herroepingsrecht (14 dagen) en onze garantie (30 dagen)">
          <p>
            Als consument heb je het wettelijke recht om binnen 14 dagen af te zien van de aankoop zonder reden: voor de
            dienst vanaf de dag van de overeenkomst, voor apparatuur vanaf de dag dat je ze ontvangt. Laat het ons weten per
            mail, of met het modelformulier onderaan. Vraag je ons om de familieruimte meteen te openen, dan stem je ermee in
            dat de dienst binnen die 14 dagen begint; trek je je dan toch terug, dan betaal je enkel voor de dagen dat ze
            open was.
          </p>
          <p>
            Daarbovenop: <strong>binnen 30 dagen na je eerste betaling</strong> kun je om welke reden ook stoppen en krijg je
            alles terug, ook de eenmalige kost. Apparatuur stuur je dan onbeschadigd terug; de verzendkost daarvan draag je
            zelf. Het archief blijft van jullie: je krijgt het als download.
          </p>
        </Clause>

        <Clause n="06" title="Maandelijks opzegbaar">
          <p>
            Er is geen minimumduur. Opzeggen kan elke maand, per mail; het abonnement eindigt op het einde van de betaalde
            maand. Tot dan blijft alles werken.
          </p>
        </Clause>

        <Clause n="07" title="Bij een overlijden">
          <p>
            Zeg het ons. De facturatie stopt dezelfde dag — geen opzegtermijn, geen laatste maand. Binnen 14 dagen krijg je het
            volledige archief als download (foto's, films, verhalen, teksten). We bewaren het 12 maanden, dan wordt het
            verwijderd, tenzij je anders vraagt.
          </p>
        </Clause>

        <Clause n="08" title="Jullie inhoud">
          <p>
            De foto's, films en verhalen blijven van jullie. Je geeft ons enkel het recht ze te bewaren en te tonen zoals de
            dienst het vraagt. Je zorgt ervoor dat je ze mag delen — ook wat andere mensen op de foto's betreft. Wat
            onrechtmatig is, verwijderen we na melding.
          </p>
        </Clause>

        <Clause n="09" title="Apparatuur">
          <p>
            Wat er per configuratie toekomt, staat op de prijzenpagina. Op apparatuur geldt de wettelijke garantie van twee
            jaar. Een defect toestel wordt hersteld of vervangen; schrijf ons. Een scherm dat wij leveren bewaart het archief
            op het toestel zelf — behandel het als een fotoalbum dat in huis staat.
          </p>
        </Clause>

        <Clause n="10" title="Beschikbaarheid en aansprakelijkheid">
          <p>
            We doen wat redelijkerwijs kan om Recall dag en nacht te laten werken en om onderbrekingen kort te houden, maar
            een dienst over het internet is nooit ononderbroken. We zijn niet aansprakelijk voor schade die voortkomt uit het
            gebruik van het archief als iets anders dan een archief. Waar de wet het toelaat, is onze aansprakelijkheid
            beperkt tot wat je de voorbije 12 maanden aan ons betaalde. Niets hier beperkt jullie wettelijke rechten als
            consument.
          </p>
        </Clause>

        <Clause n="11" title="Wijzigingen">
          <p>
            Veranderen deze voorwaarden of de prijzen, dan verwittigen we de beheerder van het archief minstens 30 dagen
            vooraf per mail. Ben je niet akkoord, dan kun je opzeggen vóór de wijziging ingaat.
          </p>
        </Clause>

        <Clause n="12" title="Recht, geschillen, klachten">
          <p>
            Belgisch recht is van toepassing. Een geschil hoort voor de rechtbank van je woonplaats. Eerst praten we: schrijf
            naar <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>. Kom je er met
            ons niet uit, dan kun je terecht bij de Consumentenombudsdienst (
            <a href="https://consumentenombudsdienst.be" className="underline underline-offset-2">consumentenombudsdienst.be</a>) of
            het Europese platform voor onlinegeschillen (
            <a href="https://ec.europa.eu/odr" className="underline underline-offset-2">ec.europa.eu/odr</a>).
          </p>
        </Clause>

        <Clause title="Modelformulier voor herroeping">
          <p className="whitespace-pre-line font-mono text-[13px] leading-[1.7]">
            {`Aan ${SELLER.tradeName}${seller ? ` (${seller})` : ""}, ${SELLER.email}:

Ik/Wij (*) deel/delen (*) u hiermee mede dat ik/wij (*) onze overeenkomst
betreffende de verkoop van de volgende goederen/levering van de volgende
dienst (*) herroep/herroepen (*):
— besteld op (*) / ontvangen op (*):
— naam/namen consument(en):
— adres consument(en):
— handtekening (alleen op papier):
— datum:

(*) doorhalen wat niet van toepassing is`}
          </p>
        </Clause>
      </PublicPage>
    );
  }

  return (
    <PublicPage
      eyebrow="TERMS"
      title="What we promise, and what we ask of you."
      lead={`Last updated ${UPDATED.en}. Short, in plain words, and binding on both of us.`}
      back="Back"
    >
      <Clause n="01" title="Who sells">
        <p>
          Recall is run from {SELLER.region}. {seller ? `Seller: ${seller}. ` : ""}
          Email: <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>
          {SELLER.phone ? `, phone ${SELLER.phone}` : ""}.
          {!seller && " Registered seller details (name, company number, VAT number, address) appear here before the first invoice is issued."}
        </p>
      </Clause>

      <Clause n="02" title="What Recall is">
        <p>
          A personal memory archive for someone living with memory loss: her photographs, films and recorded stories, arranged
          in numbered channels, shown on a screen in her home and opened with a number on the remote or a card laid on the
          reader. The family builds and manages the archive from any phone or laptop. Every month a printed card arrives in
          the post, addressed to her.
        </p>
        <p>Recall is not a medical device, not a treatment and not a substitute for care or supervision. It is an archive.</p>
      </Clause>

      <Clause n="03" title="Invitation and account">
        <p>
          Recall is invitation-only. Whoever creates an archive is an adult, manages the family account, and declares at
          creation that she herself consents to her life being shown on her screen — or that whoever may legally decide for
          her does. No archive is activated without that declaration. See the{" "}
          <Link to="/privacy" className="underline underline-offset-2">privacy policy</Link>.
        </p>
      </Clause>

      <Clause n="04" title="Prices and payment">
        <p>
          All prices on <Link to="/pricing" className="underline underline-offset-2">recall.family/pricing</Link> are total
          prices in euro, <strong>including 21% VAT</strong>. There is a one-time setup fee at the start:
          <strong>€75</strong> for Recall, <strong>€490</strong> for the Recall Dock, which includes the device itself.
          After that both configurations cost €25 a month, or €275 a year with one month free. No hidden costs.
        </p>
        <p>
          You pay by invoice, by bank transfer; no card details are asked for on this site. The archive is activated when the
          first payment arrives; the monthly price runs from that day. Hardware that is not yet available is invoiced only
          when it is ready to ship, with a concrete delivery date.
        </p>
        <p>
          If an invoice stays unpaid more than 14 days after its due date, we pause the family workspace until it is paid. Her
          screen always keeps playing.
        </p>
      </Clause>

      <Clause n="05" title="Right of withdrawal (14 days) and our guarantee (30 days)">
        <p>
          As a consumer you have the legal right to withdraw from the purchase within 14 days without giving a reason: for
          the service from the day of the contract, for hardware from the day you receive it. Tell us by email, or with the
          model form at the bottom. If you ask us to open the workspace straight away, you agree that the service starts
          within those 14 days; if you then withdraw, you pay only for the days it was open.
        </p>
        <p>
          On top of that: <strong>within 30 days of your first payment</strong> you can stop for any reason and get everything
          back, the one-time amount included. Hardware goes back undamaged; you bear its return postage. The archive stays
          yours: you receive it as a download.
        </p>
      </Clause>

      <Clause n="06" title="Cancel any month">
        <p>
          There is no minimum term. Cancel any month by email; the subscription ends at the end of the paid month. Until then
          everything keeps working.
        </p>
      </Clause>

      <Clause n="07" title="On a death">
        <p>
          Tell us. Billing stops the same day — no notice period, no last month. Within 14 days you receive the whole archive
          as a download (photographs, films, stories, text). We keep it 12 months, then delete it, unless you ask otherwise.
        </p>
      </Clause>

      <Clause n="08" title="Your content">
        <p>
          The photographs, films and stories remain yours. You give us only the right to store and show them as the service
          requires. You make sure you may share them — including as regards other people in the pictures. What is unlawful we
          remove on notice.
        </p>
      </Clause>

      <Clause n="09" title="Hardware">
        <p>
          What arrives with each configuration is on the pricing page. Hardware carries the legal two-year guarantee. A faulty
          device is repaired or replaced; write to us. A screen we supply keeps the archive on the device itself — treat it as
          a photo album that lives in the house.
        </p>
      </Clause>

      <Clause n="10" title="Availability and liability">
        <p>
          We do what can reasonably be done to keep Recall running day and night and to keep interruptions short, but a
          service over the internet is never uninterrupted. We are not liable for damage arising from using the archive as
          anything other than an archive. Where the law allows, our liability is limited to what you paid us in the past 12
          months. Nothing here limits your legal rights as a consumer.
        </p>
      </Clause>

      <Clause n="11" title="Changes">
        <p>
          If these terms or the prices change, we tell the archive's admin by email at least 30 days ahead. If you do not
          agree, you can cancel before the change takes effect.
        </p>
      </Clause>

      <Clause n="12" title="Law, disputes, complaints">
        <p>
          Belgian law applies. A dispute belongs before the court of your place of residence. We talk first: write to{" "}
          <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>. If we cannot resolve it,
          you can turn to the Belgian Consumer Mediation Service (
          <a href="https://consumerombudsman.be" className="underline underline-offset-2">consumerombudsman.be</a>) or the European
          online dispute resolution platform (
          <a href="https://ec.europa.eu/odr" className="underline underline-offset-2">ec.europa.eu/odr</a>).
        </p>
      </Clause>

      <Clause title="Model withdrawal form">
        <p className="whitespace-pre-line font-mono text-[13px] leading-[1.7]">
          {`To ${SELLER.tradeName}${seller ? ` (${seller})` : ""}, ${SELLER.email}:

I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract
of sale of the following goods (*) / for the provision of the following
service (*):
— ordered on (*) / received on (*):
— name of consumer(s):
— address of consumer(s):
— signature of consumer(s) (only if this form is notified on paper):
— date:

(*) delete as appropriate`}
        </p>
      </Clause>
    </PublicPage>
  );
}
