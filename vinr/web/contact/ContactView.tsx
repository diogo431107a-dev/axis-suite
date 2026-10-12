import type { ReactNode } from "react";
import {
  ArrowLeft,
  Cake,
  CalendarHeart,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Star,
  StickyNote,
  Trash2,
} from "lucide-react";
import { displayName, whatsappLink } from "../../shared/contact.ts";
import { ageOn, nextOccurrence } from "../../shared/dates.ts";
import { LABEL_NAMES, type Contact, type Group } from "../../shared/protocol.ts";
import { GROUP_COLORS } from "../colors.ts";
import { rememberedDate, savedAt, whenFrom } from "../format.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { addressLines, mapsLink } from "./address.ts";
import { dangerButton, iconButton, secondaryButton } from "../ui/buttons.ts";

interface ContactViewProps {
  contact: Contact;
  groups: Group[];
  countryCode: string;
  today: string;
  onBack: () => void;
  onEdit: () => void;
  onStar: () => void;
  onDelete: () => void;
  onVcard: () => void;
  onCopy: (text: string, what: string) => void;
}

/** "LinkedIn", or the address without https:// and a trailing slash. */
const websiteText = (url: string, label: string) => label || url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** "turns 40 tomorrow", "39 years old, birthday in 12 days" */
function birthdayNote(birthday: string, today: string): string {
  const next = nextOccurrence(birthday, today);
  const when = whenFrom(next, today);
  const turns = ageOn(birthday, next);
  if (turns === null) return when === "Today" ? "Birthday today" : `Birthday ${when.toLowerCase()}`;
  if (when === "Today") return `Turns ${turns} today`;
  const now = ageOn(birthday, today);
  return `${now === null ? "" : `${now} years old · `}turns ${turns} ${when.toLowerCase()}`;
}

function dateNote(date: string, today: string): string {
  const next = nextOccurrence(date, today);
  const years = ageOn(date, next);
  const when = whenFrom(next, today);
  return years === null || years === 0 ? when : `${years} ${years === 1 ? "year" : "years"} ${when.toLowerCase()}`;
}

function Row({ icon, children, actions }: { icon: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <li className="group flex items-start gap-3 py-2">
      <span className="mt-0.5 text-stone-400" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </li>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <span className="block text-xs text-stone-500">{children}</span>
);

/** A contact, read-only, with one-click call, mail, WhatsApp, map and copy. */
export function ContactView(props: ContactViewProps) {
  const { contact: c, groups, countryCode, today, onBack, onEdit, onStar, onDelete, onVcard, onCopy } = props;
  const name = displayName(c);
  const work = [c.title, c.company !== name ? c.company : ""].filter(Boolean).join(" · ");
  const inGroups = groups.filter((g) => c.groupIds.includes(g.id));
  const copyButton = (text: string, what: string) => (
    <button
      type="button"
      className={iconButton}
      aria-label={`Copy ${what}`}
      title="Copy"
      onClick={() => onCopy(text, what)}
    >
      <Copy className="h-4 w-4" />
    </button>
  );
  const icon = "h-4 w-4";
  const empty =
    c.phones.length + c.emails.length + c.addresses.length + c.websites.length + c.dates.length === 0 &&
    !c.birthday &&
    !c.memo;

  return (
    <article className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-8">
      <button type="button" className={`${iconButton} mb-3 lg:hidden`} onClick={onBack} aria-label="Back to the list">
        <ArrowLeft className="h-5 w-5" />
      </button>

      <header className="flex flex-wrap items-start gap-4">
        <Avatar contact={c} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold break-words text-stone-900">
            {name}
            <button
              type="button"
              onClick={onStar}
              aria-pressed={c.favorite}
              aria-label={c.favorite ? "Take out of the favourites" : "Add to the favourites"}
              title={c.favorite ? "Favourite" : "Add to the favourites"}
              className={`rounded p-1 ${c.favorite ? "text-amber-500 hover:text-amber-600" : "text-stone-300 hover:text-stone-500"}`}
            >
              <Star className="h-5 w-5" fill={c.favorite ? "currentColor" : "none"} />
            </button>
          </h1>
          {c.nickname && c.nickname !== name && <p className="text-sm text-stone-500">“{c.nickname}”</p>}
          {work && <p className="text-sm text-stone-600">{work}</p>}
          {inGroups.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {inGroups.map((g) => (
                <li
                  key={g.id}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${GROUP_COLORS[g.color].soft} ${GROUP_COLORS[g.color].text}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${GROUP_COLORS[g.color].dot}`} aria-hidden />
                  {g.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} onClick={onEdit}>
          <Pencil className="h-4 w-4" aria-hidden /> Edit
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={onVcard}
          title="Download this contact as a .vcf file"
        >
          <Download className="h-4 w-4" aria-hidden /> vCard
        </button>
        <span className="flex-1" />
        <button type="button" className={dangerButton} onClick={onDelete}>
          <Trash2 className="h-4 w-4" aria-hidden /> Delete
        </button>
      </div>

      {empty ? (
        <p className="mt-5 text-sm text-stone-400">Nothing else yet: Edit adds phones, emails and more.</p>
      ) : (
        <ul className="mt-5 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white px-4">
          {c.phones.map((p, i) => {
            const wa = p.whatsapp ? whatsappLink(p.number, countryCode) : null;
            return (
              <Row
                key={`p${i}`}
                icon={<Phone className={icon} />}
                actions={
                  <>
                    {wa && (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${iconButton} text-green-600 hover:text-green-700`}
                        aria-label={`WhatsApp ${p.number}`}
                        title="WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    )}
                    {copyButton(p.number, "the number")}
                  </>
                }
              >
                <a href={`tel:${p.number.replace(/[^\d+]/g, "")}`} className="text-teal-800 hover:underline">
                  {p.number}
                </a>
                <Label>
                  {LABEL_NAMES[p.label]}
                  {i === 0 && c.phones.length > 1 && " · primary"}
                  {p.whatsapp && " · WhatsApp"}
                </Label>
              </Row>
            );
          })}
          {c.emails.map((e, i) => (
            <Row key={`e${i}`} icon={<Mail className={icon} />} actions={copyButton(e.address, "the address")}>
              <a href={`mailto:${e.address}`} className="break-all text-teal-800 hover:underline">
                {e.address}
              </a>
              <Label>
                {LABEL_NAMES[e.label]}
                {i === 0 && c.emails.length > 1 && " · primary"}
              </Label>
            </Row>
          ))}
          {c.addresses.map((a, i) => (
            <Row
              key={`a${i}`}
              icon={<MapPin className={icon} />}
              actions={
                <>
                  <a
                    href={mapsLink(a)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={iconButton}
                    aria-label="Open in Google Maps"
                    title="Open in Google Maps"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  {copyButton(addressLines(a).join("\n"), "the address")}
                </>
              }
            >
              {addressLines(a).map((line, k) => (
                <span key={k} className="block text-stone-800">
                  {line}
                </span>
              ))}
              <Label>{LABEL_NAMES[a.label]}</Label>
            </Row>
          ))}
          {c.websites.map((w, i) => (
            <Row key={`w${i}`} icon={<Globe className={icon} />} actions={copyButton(w.url, "the address")}>
              <a
                href={w.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-teal-800 hover:underline"
              >
                {websiteText(w.url, w.label)}
              </a>
              {w.label && <Label>{w.url}</Label>}
            </Row>
          ))}
          {c.birthday && (
            <Row icon={<Cake className={icon} />}>
              <span className="text-stone-800">{rememberedDate(c.birthday)}</span>
              <Label>{birthdayNote(c.birthday, today)}</Label>
            </Row>
          )}
          {c.dates.map((d, i) => (
            <Row key={`d${i}`} icon={<CalendarHeart className={icon} />}>
              <span className="text-stone-800">
                {d.label || "Date"}: {rememberedDate(d.date)}
              </span>
              <Label>{dateNote(d.date, today)}</Label>
            </Row>
          ))}
          {c.memo && (
            <Row icon={<StickyNote className={icon} />}>
              <p className="break-words whitespace-pre-wrap text-stone-800">{c.memo}</p>
            </Row>
          )}
        </ul>
      )}

      <p className="mt-3 text-xs text-stone-400">Changed {savedAt(c.updatedAt)}</p>
    </article>
  );
}
