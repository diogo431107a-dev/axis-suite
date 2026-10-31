// Before I see them: one page, what matters first.
import type { ReactNode } from "react";
import type { Person } from "../../shared/protocol.ts";
import { byToldDesc } from "../model.ts";
import { usePage } from "../page.ts";
import { daysBetween, showStamp } from "../time.ts";
import { CareList } from "./Care.tsx";
import { HearsayRow } from "./Hearsay.tsx";

export function Briefing({ person }: { person: Person }) {
  const { ix, today } = usePage();
  const last = ix.lastContact(person.id);
  const threads = ix.threads(person.id, today);
  const entries = ix.entriesOf(person.id);
  const lately = entries
    .filter((e) => e.src === "U")
    .sort(byToldDesc)
    .slice(0, 4);
  const joy = ix.answersTo(person.id, "joy").at(-1);
  const likes = ix.answersTo(person.id, "likes").at(-1);
  const notToRepeat = entries.filter((e) => e.conf);
  const reports = ix.reportsOf(person.id);

  const sections: [string, ReactNode][] = [
    ["Handle with care", <CareList key="care" person={person} />],
    [
      "Last contact",
      <p key="last">
        {last ? (
          <>
            <span className="mono">{showStamp(last.told)}</span>
            {last.place && `, ${ix.placeLabel(last.place)}`} · {daysBetween(last.told.d, today)} days ago
          </>
        ) : (
          "None logged."
        )}
      </p>,
    ],
    [
      "Open threads",
      threads.length > 0 ? (
        <ol key="threads">
          {threads.map((t) => (
            <li key={t.key}>
              <b>
                {t.kind}
                {t.due && (
                  <>
                    {" · "}
                    <span className="mono">{t.due}</span>
                  </>
                )}
                .
              </b>{" "}
              {t.text}
            </li>
          ))}
        </ol>
      ) : (
        <p key="threads" className="muted">
          Nothing open.
        </p>
      ),
    ],
    [
      "Lately, in their own words",
      lately.length > 0 ? (
        <ol key="lately">
          {lately.map((e) => (
            <li key={e.id}>
              <span className="mono small">{e.told.d}</span>{" "}
              {e.wording === "quote" ? <q className="quote brief-quote">{e.body}</q> : e.body}
              {e.conf && <span className="flag conf"> Asked me not to repeat</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p key="lately" className="muted">
          Nothing unprompted yet.
        </p>
      ),
    ],
    [
      "What makes them happy",
      <div key="joy">
        <p>{joy ? joy.text : <span className="muted">Not yet known.</span>}</p>
        {likes && <p className="small muted">{likes.text}</p>}
      </div>,
    ],
  ];
  if (notToRepeat.length > 0) {
    sections.push([
      "Asked me not to repeat",
      <ol key="conf">
        {notToRepeat.map((e) => (
          <li key={e.id}>
            <span className="mono small">{e.told.d}</span> {e.body}
          </li>
        ))}
      </ol>,
    ]);
  }
  if (reports.length > 0) {
    sections.push([
      "Said about me · hearsay",
      <div key="reports">
        {reports.map((r) => (
          <HearsayRow key={r.id} note={r} />
        ))}
      </div>,
    ]);
  }

  return (
    <div className="brief">
      <div className="brief-h">
        <h2>Before I see {person.name}</h2>
        <span className="mono small muted">{today}</span>
      </div>
      {sections.map(([title, content], i) => (
        <section key={title}>
          <h4 className="sub-h">
            {i + 1} · {title}
          </h4>
          {content}
        </section>
      ))}
      <p className="small muted">
        Before mentioning anything: would they be glad I remembered? If it might feel like being watched, leave it
        unsaid.
      </p>
    </div>
  );
}
