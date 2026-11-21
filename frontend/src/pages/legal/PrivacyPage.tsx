import { Link } from "react-router-dom";
import { useLang } from "@/lib/publicLang";
import { SELLER, sellerIsRegistered } from "@/lib/seller";
import { PublicPage, Clause } from "@/components/public/PublicPage";

/**
 * The privacy policy (GDPR Art. 13/14; Belgian DPA Act art. 9), launch sweep.
 *
 * Written from what the code actually does — every category below names a
 * table or a route that exists — and from decisions the owner has been given
 * with a default (retention periods, the bereavement promise). A paragraph
 * that is not true of the product is worse than no policy, so this page is
 * kept in step with the code: change the code, change the sentence.
 *
 * Three languages, one layout, the same facts. Not a translation service: the
 * Dutch is the Belgian Dutch a family here would read, not a rendering of the
 * English word for word; the French is the Belgian legal register — the terms
 * the law itself uses (responsable du traitement, administrateur de la
 * personne, mandat extrajudiciaire), not the nearest French word.
 */

const UPDATED = { en: "16 September 2026", nl: "16 september 2026", fr: "16 septembre 2026" };

export function PrivacyPage() {
  const [lang] = useLang();
  const seller = sellerIsRegistered()
    ? `${SELLER.legalName}${SELLER.registration ? ` (${SELLER.registration})` : ""}, ${SELLER.address}`
    : null;

  if (lang === "fr") {
    return (
      <PublicPage
        eyebrow="CONFIDENTIALITÉ"
        title="Ce que nous conservons à votre sujet, et pourquoi."
        lead={`Dernière mise à jour le ${UPDATED.fr}. Ceci est écrit pour la famille qui le lit, pas pour un juriste. Ce qui est écrit ici est ce que le logiciel fait.`}
        back="Retour"
      >
        <Clause n="01" title="Qui est responsable">
          <p>
            Recall est géré depuis la {SELLER.regionFr}. {seller ? `Vendeur : ${seller}. ` : ""}
            Pour tout ce qui concerne vos données : <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>.
            {!seller && " Les coordonnées du vendeur enregistré apparaissent ici avant l’émission de la première facture."}
          </p>
          <p>
            Pour le compte, les sessions et les aperçus, Recall est le responsable du traitement. Pour ce qui se trouve
            dans les archives — les photos, les films, les récits — la famille décide avec nous : l’administrateur des
            archives choisit ce qui y entre et qui le voit ; nous déterminons comment cela est conservé et montré.
          </p>
        </Clause>

        <Clause n="02" title="De qui il s’agit">
          <p>
            De la famille qui construit les archives (administrateurs, co-auteurs, utilisateurs) et de la personne à qui
            elles sont destinées — nous disons « elle » ici, parce que Recall a commencé pour Margaret.
          </p>
          <p>
            Être le sujet d’archives Recall dit quelque chose sur sa santé. C’est pourquoi nous traitons tout ce qui la
            concerne comme des données sensibles, une photo ou un prénom compris : conservées plus strictement, vues par
            moins de personnes, et uniquement avec un consentement explicite (voir 04).
          </p>
        </Clause>

        <Clause n="03" title="Ce que nous conservons">
          <p><strong>Quand vous demandez une invitation :</strong> votre adresse e-mail, votre nom et ce que vous nous écrivez au sujet de la personne à qui les archives sont destinées.</p>
          <p>
            <strong>Le compte de la famille :</strong> le nom, l’adresse e-mail et le mot de passe de l’administrateur (le
            mot de passe est conservé sous forme hachée et n’est lisible par personne) ; une date de naissance et un lieu
            de résidence si vous les donnez. De chaque co-auteur ou utilisateur : le nom, le lien avec elle, l’adresse
            e-mail, un code PIN (haché), et s’ils les donnent un numéro de téléphone et une adresse postale.
          </p>
          <p>
            <strong>À son sujet :</strong> son nom, sa date de naissance, une courte description, une photo, son lieu de
            résidence, une note de la famille, et l’adresse postale où vont les cartes.
          </p>
          <p>
            <strong>Le contenu des archives :</strong> les photos, les films et les récits enregistrés, les titres et les
            descriptions, qui les a ajoutés et quand.
          </p>
          <p>
            <strong>Utilisation :</strong> quel canal a été ouvert sur son écran, quand et pendant combien de temps ; ce
            qui s’est passé dans l’espace famille (qui a ajouté ou modifié quoi — le journal d’activité) ; de chaque
            session connectée le type de navigateur et une adresse IP raccourcie, pour repérer un usage abusif ; quels
            écrans sont associés aux archives.
          </p>
          <p>
            <strong>Aperçus :</strong> à partir de cette utilisation, nous calculons des chiffres simples pour la famille
            — quels canaux elle ouvre le plus souvent, et quand. Rien de tout cela n’est partagé avec d’autres ni utilisé
            pour autre chose.
          </p>
        </Clause>

        <Clause n="04" title="Pourquoi, et sur quelle base">
          <p><strong>Pour fournir les archives</strong> que vous avez commandées : le contrat avec la famille.</p>
          <p>
            <strong>Pour montrer sa vie sur son écran :</strong> son consentement explicite — ou, si elle ne peut plus le
            donner elle-même, celui de la personne qui peut légalement décider pour elle (un administrateur de la
            personne, « bewind over de persoon », ou un mandat extrajudiciaire, « zorgvolmacht », qui le couvre). À la
            création des archives, la famille déclare lequel des trois s’applique et qui signe. Nous conservons cette
            déclaration avec les archives. Le consentement peut être retiré à tout moment ; l’écran s’éteint alors et les
            archives sont exportées ou supprimées (voir 07).
          </p>
          <p><strong>Pour imprimer et poster les cartes :</strong> son adresse postale, pour cela uniquement.</p>
          <p>
            <strong>Pour garder le service sûr :</strong> notre intérêt légitime — les sessions, le journal et l’adresse
            IP raccourcie servent à repérer un mot de passe volé ou un inconnu, pas à suivre quelqu’un.
          </p>
        </Clause>

        <Clause n="05" title="Qui voit quoi">
          <p>
            <strong>Son écran</strong> montre le contenu des archives et son prénom. Il ne reçoit jamais l’adresse e-mail,
            le numéro de téléphone ou l’adresse de qui que ce soit — le logiciel ne les y envoie pas.
          </p>
          <p>
            <strong>La famille</strong> voit selon son rôle : un administrateur voit et gère tout, un co-auteur ajoute et
            voit les personnes des archives, un utilisateur regarde. Les coordonnées des membres de la famille ne sont
            vues que par les administrateurs, et chacun voit les siennes.
          </p>
          <p>
            <strong>Celui qui fait tourner Recall</strong> voit de chaque famille le nom du compte et l’adresse e-mail,
            des nombres (combien de canaux, combien de fichiers), et la file des cartes à imprimer — avec la photo et
            l’adresse postale qui figurent sur la carte, parce qu’elle est imprimée et postée à la main. Pas le contenu
            de vos archives, sauf si vous nous le demandez.
          </p>
          <p>
            <strong>Personne d’autre.</strong> Pas de publicité, pas d’analytique, aucune vente ni transmission de données.
          </p>
        </Clause>

        <Clause n="06" title="Où cela se trouve et qui nous aide">
          <p>
            La base de données et les fichiers sont hébergés chez <strong>Supabase</strong>, dans l’Union européenne. Le
            logiciel qui sert le tout tourne chez <strong>Google Cloud</strong> en Belgique (région europe-west1). Le site
            web et le nom de domaine passent par <strong>Cloudflare</strong> ; les e-mails (invitations, codes, un nouveau
            mot de passe) sont envoyés via <strong>Google</strong>. Chacun d’eux ne traite que sur nos instructions, dans
            le cadre d’un contrat de sous-traitance.
          </p>
          <p>
            Un écran que nous fournissons conserve les photos et les films des archives sur l’appareil lui-même, afin
            qu’il continue de jouer si l’internet tombe un instant. Qui a l’appareil à la maison a les archives à la
            maison.
          </p>
          <p>
            Les données ne quittent pas l’Union européenne, sauf là où Cloudflare fonctionne comme réseau mondial — sous
            les clauses contractuelles types de la Commission européenne et le cadre de protection des données
            UE–États-Unis (EU–US Data Privacy Framework).
          </p>
        </Clause>

        <Clause n="07" title="Combien de temps">
          <p>Tant que les archives sont actives, nous les conservons. Ensuite :</p>
          <p>
            Les sessions : 90 jours après leur fin. Le journal d’activité et les visites de canaux : 24 mois. Une demande
            d’invitation restée sans suite : 12 mois. Des archives arrêtées : conservées 12 mois, puis supprimées — sauf
            si la famille demande une suppression plus tôt, ou une conservation plus longue.
          </p>
          <p>
            <strong>En cas de décès,</strong> la facturation s’arrête le jour où vous nous le dites. Dans les 14 jours,
            vous recevez les archives complètes en téléchargement (photos, films, récits, textes). Les archives sont
            conservées 12 mois, puis supprimées, sauf si vous demandez autre chose.
          </p>
        </Clause>

        <Clause n="08" title="Vos droits">
          <p>
            L’accès, la rectification, l’effacement, la portabilité (un téléchargement des archives), la limitation,
            l’opposition, et le retrait du consentement — pour la famille et pour elle, par l’intermédiaire de la personne
            qui peut parler en son nom. Un seul e-mail à{" "}
            <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a> suffit ; nous
            répondons dans le mois.
          </p>
          <p>
            Vous pouvez aussi introduire une plainte auprès de l’Autorité de protection des données : Rue de la Presse 35,
            1000 Bruxelles,{" "}
            <a href="https://www.autoriteprotectiondonnees.be" className="underline underline-offset-2">autoriteprotectiondonnees.be</a>.
          </p>
        </Clause>

        <Clause n="09" title="Cookies">
          <p>
            Uniquement ce qu’il faut pour rester connecté, et donc pas de bandeau. Trois cookies, tous les trois
            illisibles pour les scripts et réservés à ce site : <code>recall_family</code> (la session de la famille),{" "}
            <code>recall_profile</code> (qui est au clavier, 8 heures pour les administrateurs), <code>recall_device</code>{" "}
            (que cet écran est un écran de confiance, 30 jours — pour que son écran ne soit jamais interrompu). Le
            navigateur retient aussi votre choix de langue et le thème clair ou sombre. Aucun cookie de mesure ni de
            publicité, de personne.
          </p>
        </Clause>

        <Clause n="10" title="Sécurité">
          <p>
            Tout voyage chiffré (HTTPS). Les photos et les films se trouvent dans un stockage fermé et ne sont montrés
            qu’à travers notre propre serveur, à ceux qui y ont droit. Les mots de passe et les codes PIN sont conservés
            sous forme hachée. Cinq codes PIN erronés verrouillent un profil pendant un quart d’heure. Le navigateur ne
            reçoit jamais de clé vers la base de données.
          </p>
        </Clause>

        <Clause n="11" title="Modifications">
          <p>
            Si ce texte change, la date en haut de page change, et nous prévenons par e-mail l’administrateur de chaque
            archive lorsqu’il s’agit d’un changement substantiel. Questions :{" "}
            <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>. Voyez aussi les{" "}
            <Link to="/terms" className="underline underline-offset-2">conditions générales</Link>.
          </p>
        </Clause>
      </PublicPage>
    );
  }

  if (lang === "nl") {
    return (
      <PublicPage
        eyebrow="PRIVACY"
        title="Wat we over jullie bewaren, en waarom."
        lead={`Laatst bijgewerkt op ${UPDATED.nl}. Dit is geschreven voor de familie die het leest, niet voor een jurist. Wat hier staat, is wat de software doet.`}
        back="Terug"
      >
        <Clause n="01" title="Wie verantwoordelijk is">
          <p>
            Recall wordt gerund vanuit {SELLER.regionNl}. {seller ? `Verkoper: ${seller}. ` : ""}
            Voor alles wat met jullie gegevens te maken heeft: <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>.
            {!seller && " De geregistreerde verkopersgegevens verschijnen hier vóór de eerste factuur."}
          </p>
          <p>
            Voor de account, de sessies en de inzichten is Recall de verwerkingsverantwoordelijke. Voor wat er in het archief
            staat — de foto's, de films, de verhalen — beslist de familie samen met ons: de beheerder van het archief kiest
            wat erin komt en wie het ziet; wij bepalen hoe het wordt bewaard en getoond.
          </p>
        </Clause>

        <Clause n="02" title="Over wie het gaat">
          <p>
            Over de familie die het archief bouwt (beheerders, mede-auteurs, gebruikers) en over de persoon voor wie het is —
            wij noemen haar hier "zij", omdat Recall voor Margaret begon.
          </p>
          <p>
            Dat iemand het onderwerp van een Recall-archief is, zegt iets over haar gezondheid. Daarom behandelen we alles wat
            over haar gaat als gevoelige gegevens, ook een foto of een voornaam: strenger bewaard, door minder mensen
            gezien, en alleen met een uitdrukkelijke toestemming (zie 04).
          </p>
        </Clause>

        <Clause n="03" title="Wat we bewaren">
          <p><strong>Als je een uitnodiging vraagt:</strong> je e-mailadres, je naam en wat je ons schrijft over voor wie het is.</p>
          <p>
            <strong>De familieaccount:</strong> de naam, het e-mailadres en het wachtwoord van de beheerder (het wachtwoord
            wordt versleuteld opgeslagen en is voor niemand leesbaar); geboortedatum en woonplaats als je die geeft. Van elke
            mede-auteur of gebruiker: naam, relatie tot haar, e-mailadres, een pincode (versleuteld), en als ze het geven een
            telefoonnummer en een postadres.
          </p>
          <p>
            <strong>Over haar:</strong> haar naam, haar geboortedag, een korte beschrijving, een foto, haar woonplaats, een
            notitie van de familie, en het postadres waar de kaarten naartoe gaan.
          </p>
          <p>
            <strong>De inhoud van het archief:</strong> de foto's, films en ingesproken verhalen, de titels en beschrijvingen,
            wie ze toevoegde en wanneer.
          </p>
          <p>
            <strong>Gebruik:</strong> welk kanaal op haar scherm werd geopend, wanneer en hoelang; wat er in de familieruimte
            gebeurde (wie wat toevoegde of wijzigde — het activiteitenlogboek); van elke ingelogde sessie het type browser en
            een ingekort IP-adres, om misbruik te herkennen; welke schermen aan het archief gekoppeld zijn.
          </p>
          <p>
            <strong>Inzichten:</strong> uit het gebruik berekenen we eenvoudige cijfers voor de familie — welke kanalen ze het
            vaakst opent, wanneer. Niets daarvan wordt met anderen gedeeld of voor iets anders gebruikt.
          </p>
        </Clause>

        <Clause n="04" title="Waarom, en op welke grond">
          <p><strong>Om het archief te leveren</strong> dat jullie bestelden: de overeenkomst met de familie.</p>
          <p>
            <strong>Om haar leven op haar scherm te tonen:</strong> haar uitdrukkelijke toestemming — of, als zij die niet meer
            zelf kan geven, die van wie wettelijk voor haar mag beslissen (een bewindvoerder over de persoon, of een
            zorgvolmacht die dit dekt). Bij het aanmaken van het archief verklaart de familie wie van de drie het is en wie
            tekent. Die verklaring bewaren we bij het archief. Toestemming kan altijd worden ingetrokken; dan gaat het scherm
            uit en wordt het archief geëxporteerd of verwijderd (zie 07).
          </p>
          <p><strong>Om kaarten te drukken en te posten:</strong> haar postadres, alleen daarvoor.</p>
          <p>
            <strong>Om de dienst veilig te houden:</strong> ons gerechtvaardigd belang — sessies, het logboek en het ingekorte
            IP-adres dienen om een gestolen wachtwoord of een vreemde op te merken, niet om iemand te volgen.
          </p>
        </Clause>

        <Clause n="05" title="Wie wat ziet">
          <p>
            <strong>Haar scherm</strong> toont de inhoud van het archief en haar voornaam. Het krijgt nooit e-mailadressen,
            telefoonnummers of adressen van wie dan ook — de software stuurt ze er niet naartoe.
          </p>
          <p>
            <strong>De familie</strong> ziet volgens rol: een beheerder ziet en beheert alles, een mede-auteur voegt toe en ziet
            de mensen van het archief, een gebruiker kijkt. Contactgegevens van familieleden zien alleen beheerders, en ieder
            de zijne.
          </p>
          <p>
            <strong>Wie Recall rund</strong> ziet van elke familie de accountnaam en het e-mailadres, aantallen (hoeveel kanalen,
            hoeveel bestanden), en de wachtrij van te drukken kaarten — met de foto en het postadres op de kaart, omdat die
            met de hand wordt gedrukt en gepost. Niet de inhoud van jullie archief, tenzij jullie ons erom vragen.
          </p>
          <p>
            <strong>Niemand anders.</strong> Geen reclame, geen analytics, geen verkoop of doorgifte van gegevens.
          </p>
        </Clause>

        <Clause n="06" title="Waar het staat en wie ons helpt">
          <p>
            De database en de bestanden staan bij <strong>Supabase</strong>, in de Europese Unie. De software die alles bedient
            draait bij <strong>Google Cloud</strong> in België (regio europe-west1). De website en de domeinnaam lopen via{" "}
            <strong>Cloudflare</strong>; e-mails (uitnodigingen, codes, een nieuw wachtwoord) worden verstuurd via{" "}
            <strong>Google</strong>. Elk van hen verwerkt enkel in onze opdracht, onder een verwerkersovereenkomst.
          </p>
          <p>
            Een scherm dat wij leveren bewaart de foto's en films van het archief op het toestel zelf, zodat het blijft spelen
            als het internet even wegvalt. Wie het toestel in huis heeft, heeft het archief in huis.
          </p>
          <p>
            Gegevens verlaten de Europese Unie niet, behalve waar Cloudflare als wereldwijd netwerk werkt — onder de
            standaardcontractbepalingen van de Europese Commissie en het EU-VS Data Privacy Framework.
          </p>
        </Clause>

        <Clause n="07" title="Hoelang">
          <p>Zolang het archief actief is, bewaren we het. Daarna:</p>
          <p>
            Sessies: 90 dagen na afloop. Activiteitenlogboek en kanaalbezoeken: 24 maanden. Een gevraagde uitnodiging zonder
            gevolg: 12 maanden. Een stopgezet archief: 12 maanden bewaard, dan verwijderd — tenzij de familie eerder om
            verwijdering vraagt of om langer te bewaren.
          </p>
          <p>
            <strong>Bij een overlijden</strong> stopt de facturatie de dag dat je het ons zegt. Binnen 14 dagen krijg je het
            volledige archief als download (foto's, films, verhalen, teksten). Het archief blijft 12 maanden bewaard, dan
            wordt het verwijderd, tenzij je anders vraagt.
          </p>
        </Clause>

        <Clause n="08" title="Jullie rechten">
          <p>
            Inzage, verbetering, verwijdering, overdracht (een download van het archief), beperking, bezwaar, en het
            intrekken van toestemming — voor de familie én voor haar, via wie voor haar mag spreken. Eén mail naar{" "}
            <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a> volstaat; we antwoorden
            binnen een maand.
          </p>
          <p>
            Klachten kunnen ook bij de Gegevensbeschermingsautoriteit: Drukpersstraat 35, 1000 Brussel,{" "}
            <a href="https://www.gegevensbeschermingsautoriteit.be" className="underline underline-offset-2">gegevensbeschermingsautoriteit.be</a>.
          </p>
        </Clause>

        <Clause n="09" title="Cookies">
          <p>
            Alleen wat nodig is om ingelogd te blijven, en daarom geen banner. Drie cookies, alle drie onleesbaar voor scripts
            en enkel voor deze site: <code>recall_family</code> (de familiesessie), <code>recall_profile</code> (wie er aan het
            toetsenbord zit, 8 uur voor beheerders), <code>recall_device</code> (dat dit een vertrouwd scherm is, 30 dagen —
            zodat haar scherm nooit onderbroken wordt). In de browser onthouden we ook je taalkeuze en het lichte of donkere
            thema. Geen meet- of reclamecookies, van niemand.
          </p>
        </Clause>

        <Clause n="10" title="Beveiliging">
          <p>
            Alles reist versleuteld (HTTPS). Foto's en films staan in afgesloten opslag en worden alleen via onze eigen server
            getoond aan wie er recht op heeft. Wachtwoorden en pincodes worden gehasht bewaard. Vijf foute pincodes sluiten
            een profiel een kwartier. De browser krijgt nooit een sleutel tot de database.
          </p>
        </Clause>

        <Clause n="11" title="Wijzigingen">
          <p>
            Als deze tekst verandert, staat de datum bovenaan en verwittigen we de beheerder van elk archief per mail als het
            om iets wezenlijks gaat. Vragen: <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>.
            Zie ook de <Link to="/terms" className="underline underline-offset-2">voorwaarden</Link>.
          </p>
        </Clause>
      </PublicPage>
    );
  }

  return (
    <PublicPage
      eyebrow="PRIVACY"
      title="What we keep about you, and why."
      lead={`Last updated ${UPDATED.en}. Written for the family who reads it, not for a lawyer. What is written here is what the software does.`}
      back="Back"
    >
      <Clause n="01" title="Who is responsible">
        <p>
          Recall is run from {SELLER.region}. {seller ? `Seller: ${seller}. ` : ""}
          For anything about your data: <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>.
          {!seller && " Registered seller details appear here before the first invoice is issued."}
        </p>
        <p>
          For the account, the sessions and the insights, Recall is the controller. For what sits in the archive — the
          photographs, films and stories — the family decides together with us: the archive's admin chooses what goes in and
          who sees it; we decide how it is stored and shown.
        </p>
      </Clause>

      <Clause n="02" title="Who it is about">
        <p>
          The family building the archive (admins, co-authors, users), and the person it is for — we say "she" here, because
          Recall began for Margaret.
        </p>
        <p>
          Being the subject of a Recall archive says something about her health. So everything about her is treated as
          sensitive data, a photograph or a first name included: kept more strictly, seen by fewer people, and only with an
          explicit consent (see 04).
        </p>
      </Clause>

      <Clause n="03" title="What we keep">
        <p><strong>When you ask for an invitation:</strong> your email address, your name and what you write about who it is for.</p>
        <p>
          <strong>The family account:</strong> the admin's name, email and password (stored hashed, readable by nobody); a birth
          date and a location if you give them. For each co-author or user: name, relationship to her, email, a PIN (hashed),
          and a phone number and postal address if they give them.
        </p>
        <p>
          <strong>About her:</strong> her name, her birthday, a short description, a photograph, where she lives, a note from the
          family, and the postal address the cards are sent to.
        </p>
        <p>
          <strong>The archive itself:</strong> the photographs, films and recorded stories, their titles and descriptions, who added
          them and when.
        </p>
        <p>
          <strong>Use:</strong> which channel was opened on her screen, when and for how long; what happened in the workspace (who
          added or changed what — the activity log); for each signed-in session the browser type and a shortened IP address,
          to recognise misuse; which screens are paired to the archive.
        </p>
        <p>
          <strong>Insights:</strong> from that use we compute simple figures for the family — which channels she opens most, and
          when. None of it is shared or used for anything else.
        </p>
      </Clause>

      <Clause n="04" title="Why, and on what basis">
        <p><strong>To provide the archive</strong> you ordered: the contract with the family.</p>
        <p>
          <strong>To show her life on her screen:</strong> her explicit consent — or, if she can no longer give it herself, that of
          whoever may legally decide for her (a court-appointed guardian for personal matters, or a care mandate that covers
          this). When the archive is created the family declares which of the three applies and who signs. We keep that
          declaration with the archive. Consent can be withdrawn at any time; the screen then goes dark and the archive is
          exported or deleted (see 07).
        </p>
        <p><strong>To print and post cards:</strong> her postal address, for that alone.</p>
        <p>
          <strong>To keep the service safe:</strong> our legitimate interest — sessions, the log and the shortened IP address exist
          to notice a stolen password or a stranger, not to follow anyone.
        </p>
      </Clause>

      <Clause n="05" title="Who sees what">
        <p>
          <strong>Her screen</strong> shows the archive's content and her first name. It is never sent anyone's email, phone number
          or address — the software does not send them there.
        </p>
        <p>
          <strong>The family</strong> sees by role: an admin sees and manages everything, a co-author adds and sees the people of
          the archive, a user looks. Family members' contact details are seen by admins only, and each by themselves.
        </p>
        <p>
          <strong>Whoever runs Recall</strong> sees each family's account name and email, counts (how many channels, how many
          files), and the queue of cards to print — with the photograph and the postal address on the card, because it is
          printed and posted by hand. Not the content of your archive, unless you ask us to look.
        </p>
        <p><strong>Nobody else.</strong> No advertising, no analytics, no sale or transfer of data.</p>
      </Clause>

      <Clause n="06" title="Where it lives and who helps us">
        <p>
          The database and the files are held by <strong>Supabase</strong>, in the European Union. The software serving it runs
          on <strong>Google Cloud</strong> in Belgium (region europe-west1). The website and the domain go through{" "}
          <strong>Cloudflare</strong>; emails (invitations, codes, a new password) are sent through <strong>Google</strong>. Each
          processes only on our instruction, under a data processing agreement.
        </p>
        <p>
          A screen we supply keeps the archive's photographs and films on the device itself, so it keeps playing when the
          internet drops. Whoever has the device in the house has the archive in the house.
        </p>
        <p>
          Data does not leave the European Union, except where Cloudflare operates as a worldwide network — under the
          European Commission's standard contractual clauses and the EU–US Data Privacy Framework.
        </p>
      </Clause>

      <Clause n="07" title="For how long">
        <p>For as long as the archive is active, we keep it. Then:</p>
        <p>
          Sessions: 90 days after they end. Activity log and channel visits: 24 months. An invitation request that led
          nowhere: 12 months. A closed archive: kept 12 months, then deleted — unless the family asks for deletion sooner, or
          to keep it longer.
        </p>
        <p>
          <strong>On a death,</strong> billing stops the day you tell us. Within 14 days you receive the whole archive as a
          download (photographs, films, stories, text). The archive is kept 12 months and then deleted, unless you ask
          otherwise.
        </p>
      </Clause>

      <Clause n="08" title="Your rights">
        <p>
          Access, correction, deletion, portability (a download of the archive), restriction, objection, and withdrawing
          consent — for the family and for her, through whoever may speak for her. One email to{" "}
          <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a> is enough; we answer within a
          month.
        </p>
        <p>
          You can also complain to the Belgian Data Protection Authority: Rue de la Presse 35, 1000 Brussels,{" "}
          <a href="https://www.dataprotectionauthority.be" className="underline underline-offset-2">dataprotectionauthority.be</a>.
        </p>
      </Clause>

      <Clause n="09" title="Cookies">
        <p>
          Only what is needed to stay signed in, so no banner. Three cookies, all unreadable to scripts and only for this
          site: <code>recall_family</code> (the family session), <code>recall_profile</code> (who is at the keyboard, 8 hours for
          admins), <code>recall_device</code> (that this is a trusted screen, 30 days — so her screen is never interrupted). The
          browser also remembers your language and the light or dark theme. No measurement or advertising cookies, from
          anyone.
        </p>
      </Clause>

      <Clause n="10" title="Security">
        <p>
          Everything travels encrypted (HTTPS). Photographs and films sit in closed storage and are shown only through our
          own server, to those entitled to them. Passwords and PINs are stored hashed. Five wrong PINs lock a profile for a
          quarter of an hour. The browser never receives a key to the database.
        </p>
      </Clause>

      <Clause n="11" title="Changes">
        <p>
          If this text changes, the date at the top changes, and each archive's admin is told by email when the change
          matters. Questions: <a href={`mailto:${SELLER.email}`} className="underline underline-offset-2">{SELLER.email}</a>. See also
          the <Link to="/terms" className="underline underline-offset-2">terms</Link>.
        </p>
      </Clause>
    </PublicPage>
  );
}
