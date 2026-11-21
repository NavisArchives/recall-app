import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, X } from "lucide-react";

import { Wordmark } from "@/components/Wordmark";
import { useAuth } from "@/context/AuthContext";
import { LANGS, useLang } from "@/lib/publicLang";

/**
 * The phone menu for the dark public navs (owner, 21 Sep 2026).
 *
 * Below 900px the bar on the front page and on /archive-service wrapped into
 * three ragged rows — links, then "Archive service" and the Sign in pill on a
 * line of their own, with the language disc floating above it all. The owner
 * called it a mess and asked for one control: a hamburger that opens a
 * full-screen, glass overlay holding the links, sign in or out, and the
 * language switch. The desktop bar is untouched; this component is the whole
 * of the phone version.
 *
 * IT IS ONE MENU FOR BOTH NAVS. The two bars draw the same links, so the menu
 * reads where it is from the router: on the landing page the section links
 * are hash anchors and scroll; anywhere else they are routes back to the
 * front page. The archive service is a route on both, and is marked as the
 * current page when you are already on it.
 *
 * SIGN OUT IS OFFERED ONLY TO A FAMILY SESSION (`hasFamily`), never to a
 * device-only one: `signOut` signs the whole installation out and gives up
 * the family's one trusted-screen slot, and a helper browsing the front page
 * on the family screen must not be able to do that from a menu. On the
 * screen the menu simply offers Sign in, which is harmless.
 *
 * THE OVERLAY IS PORTALLED TO BODY, not drawn inside the bar. The hero's
 * ground stacks blurred photographs and gradients with their own
 * positioning, and a `position: fixed` panel inside them is fixed to the
 * wrong thing. Body has no `.site` scope, so the overlay's few colours are
 * stated in site.css under `.s-menu`, the way the dark panels' are.
 *
 * The language row is the same three glass discs the shared LangToggle
 * draws, laid flat instead of folded into a popover: in a full-screen menu
 * there is room to show all three, and a popover inside an overlay is a
 * menu inside a menu.
 */

const COPY = {
  fr: {
    menu: "Menu",
    close: "Fermer le menu",
    nav: "Navigation",
    how: "Comment ça marche",
    postcards: "Cartes postales",
    pricing: "Prix",
    service: "Service d’archivage",
    signIn: "Se connecter",
    signOut: "Se déconnecter",
    language: "Langue",
  },
  nl: {
    menu: "Menu",
    close: "Menu sluiten",
    nav: "Navigatie",
    how: "Zo werkt het",
    postcards: "Postkaarten",
    pricing: "Prijzen",
    service: "Archiefdienst",
    signIn: "Inloggen",
    signOut: "Uitloggen",
    language: "Taal",
  },
  en: {
    menu: "Menu",
    close: "Close menu",
    nav: "Navigation",
    how: "How it works",
    postcards: "Postcards",
    pricing: "Pricing",
    service: "Archive service",
    signIn: "Sign in",
    signOut: "Sign out",
    language: "Language",
  },
} as const;

export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useLang();
  const { hasFamily, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const t = COPY[lang];

  /* `/` is the front door and renders the landing page for a stranger;
     `/welcome` is the landing page and only ever that. */
  const onLanding = pathname === "/welcome" || pathname === "/";
  const section = (hash: string, route: string) => (onLanding ? `#${hash}` : route);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  /*
    Escape closes and gives the focus back, exactly as the language popover
    does. The close button takes focus on open so a keyboard is inside the
    dialog straight away. Both only exist while the panel is open.
  */
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function leave() {
    await signOut();
    close();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="pressable s-menu__disc s-nav-burger"
        aria-label={t.menu}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(true)}
      >
        <Menu size={18} strokeWidth={1.6} aria-hidden />
      </button>

      {open &&
        createPortal(
          <div id={panelId} className="s-menu" role="dialog" aria-modal="true" aria-label={t.menu}>
            <div className="s-menu__bar">
              <a href={onLanding ? "#top" : "/welcome"} onClick={close} aria-label="Recall">
                <Wordmark size={18} />
              </a>
              <button
                ref={closeButton}
                type="button"
                className="pressable s-menu__disc"
                aria-label={t.close}
                onClick={close}
              >
                <X size={18} strokeWidth={1.6} aria-hidden />
              </button>
            </div>

            <nav aria-label={t.nav} className="s-menu__links">
              <a className="s-menu__link" href={section("how", "/welcome#how")} onClick={close}>
                {t.how}
              </a>
              <a className="s-menu__link" href={section("postcards", "/postcards")} onClick={close}>
                {t.postcards}
              </a>
              <a className="s-menu__link" href={section("pricing", "/pricing")} onClick={close}>
                {t.pricing}
              </a>
              <Link
                className="s-menu__link"
                to="/archive-service"
                aria-current={pathname === "/archive-service" ? "page" : undefined}
                onClick={close}
              >
                {t.service}
              </Link>
            </nav>

            <div className="s-menu__row">
              {hasFamily ? (
                <button type="button" className="pressable s-menu__btn" onClick={() => void leave()}>
                  {t.signOut}
                </button>
              ) : (
                <button
                  type="button"
                  className="pressable s-menu__btn"
                  onClick={() => {
                    close();
                    navigate("/login");
                  }}
                >
                  {t.signIn}
                </button>
              )}
            </div>

            <div className="s-menu__row">
              <span className="s-menu__label">{t.language}</span>
              <div role="group" aria-label={t.language} className="s-menu__langs">
                {LANGS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className="pressable s-menu__lang"
                    aria-pressed={l === lang}
                    onClick={() => setLang(l)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
