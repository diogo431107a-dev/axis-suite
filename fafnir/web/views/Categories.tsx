import { useState, type FormEvent } from "react";
import { Check, Pencil, Trash2, EyeOff, Eye } from "lucide-react";
import { CATEGORY_KINDS, type Account, type Book, type CategoryKind, type NewCategory } from "../../shared/protocol.ts";
import { api, describeError } from "../api.ts";

const TITLES: Record<CategoryKind, string> = { expense: "Spending", income: "Income" };

function CategoryRow({
  category,
  onDone,
  onError,
}: {
  category: Account;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);

  const act = (work: Promise<unknown>) => {
    onError("");
    work.then(onDone).catch((err: unknown) => onError(describeError(err)));
  };
  const path = `/api/accounts/${category.id}`;

  const rename = (e: FormEvent) => {
    e.preventDefault();
    setEditing(false);
    if (name.trim() && name !== category.name) act(api(path, { method: "PATCH", body: { name } }));
    else setName(category.name);
  };

  if (editing) {
    return (
      <li className="category">
        <form onSubmit={rename}>
          <input autoFocus aria-label="Name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="icon-btn" aria-label="Save the name">
            <Check aria-hidden />
          </button>
        </form>
      </li>
    );
  }
  return (
    <li className={`category ${category.closed ? "closed" : ""}`}>
      <span>{category.name}</span>
      <small className="muted">
        {category.entries === 1 ? "1 entry" : `${category.entries} entries`}
        {category.closed ? " · hidden" : ""}
      </small>
      <span className="category-actions">
        <button
          type="button"
          className="icon-btn"
          aria-label={`Rename ${category.name}`}
          title="Rename"
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden />
        </button>
        {category.entries === 0 ? (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Delete ${category.name}`}
            title="Delete"
            onClick={() => act(api(path, { method: "DELETE" }))}
          >
            <Trash2 aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn"
            aria-label={`${category.closed ? "Show" : "Hide"} ${category.name}`}
            title={category.closed ? "Show it when adding entries" : "Hide it when adding entries"}
            onClick={() => act(api(path, { method: "PATCH", body: { closed: !category.closed } }))}
          >
            {category.closed ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
          </button>
        )}
      </span>
    </li>
  );
}

export function Categories({ book, onChanged }: { book: Book; onChanged: () => void }) {
  const [error, setError] = useState("");
  const [names, setNames] = useState<Record<CategoryKind, string>>({ expense: "", income: "" });

  const add = (kind: CategoryKind) => (e: FormEvent) => {
    e.preventDefault();
    const name = names[kind].trim();
    if (!name) return;
    setError("");
    const body: NewCategory = { id: crypto.randomUUID(), name, kind };
    api("/api/categories", { method: "POST", body })
      .then(() => {
        setNames({ ...names, [kind]: "" });
        onChanged();
      })
      .catch((err: unknown) => setError(describeError(err)));
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Categories</h1>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="category-columns">
        {CATEGORY_KINDS.map((kind) => (
          <section key={kind}>
            <h2>{TITLES[kind]}</h2>
            <ul className="categories">
              {book.categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <CategoryRow key={c.id} category={c} onDone={onChanged} onError={setError} />
                ))}
            </ul>
            <form className="add-category" onSubmit={add(kind)}>
              <input
                aria-label={`New ${TITLES[kind].toLowerCase()} category`}
                placeholder="New category"
                value={names[kind]}
                maxLength={100}
                onChange={(e) => setNames({ ...names, [kind]: e.target.value })}
              />
              <button type="submit" className="btn">
                Add
              </button>
            </form>
          </section>
        ))}
      </div>
    </section>
  );
}
