import { useMemo, useRef, useState } from "react";
import { searchPlaceCities } from "@/lib/social/profile-facts";
import countries from "@/lib/places/countries.json";

type CityHit = { id: string; name: string; region: string };

export function PlaceFields({
  country,
  city,
  onCountry,
  onCity,
}: {
  country: string;
  city: string;
  onCountry: (name: string) => void;
  onCity: (name: string) => void;
}) {
  const [countryQuery, setCountryQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<CityHit[] | null>(null);
  const [open, setOpen] = useState<"country" | "city" | null>(null);
  const cityWait = useRef(0);
  const cityToken = useRef("");

  const selected = useMemo(() => countries.find((row) => row.name === country) ?? null, [country]);
  const shown = useMemo(() => {
    const q = countryQuery.trim().toLocaleLowerCase("ru");
    if (!q) return countries.slice(0, 12);
    return countries.filter((row) => row.name.toLocaleLowerCase("ru").includes(q) || row.iso.toLowerCase() === q).slice(0, 12);
  }, [countryQuery]);

  function lookCities(value: string) {
    setCityQuery(value);
    window.clearTimeout(cityWait.current);
    const query = value.trim();
    if (!selected || query.length < 2) {
      setCities(null);
      return;
    }
    const iso = selected.iso;
    cityToken.current = query;
    cityWait.current = window.setTimeout(() => {
      void searchPlaceCities({ data: { iso, query } })
        .then((rows) => {
          if (cityToken.current === query) setCities(rows);
        })
        .catch(() => {
          if (cityToken.current === query) setCities([]);
        });
    }, 250);
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-faint">
        Страна
        <input
          className="field mt-1"
          value={open === "country" ? countryQuery : country}
          placeholder="Начните вводить страну"
          onFocus={() => {
            setOpen("country");
            setCountryQuery("");
          }}
          onChange={(event) => setCountryQuery(event.target.value)}
        />
      </label>
      {open === "country" ? (
        <ul className="max-h-48 overflow-y-auto rounded-2xl border border-line bg-bg">
          {shown.map((row) => (
            <li key={row.iso}>
              <button
                type="button"
                className="press flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-subtle"
                onClick={() => {
                  if (row.name !== country) onCity("");
                  onCountry(row.name);
                  setOpen(null);
                  setCityQuery("");
                  setCities(null);
                }}
              >
                <span aria-hidden="true">{row.flag}</span>
                {row.name}
              </button>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-3 py-2 text-xs text-faint">Такой страны нет</li> : null}
        </ul>
      ) : null}
      <label className="block text-xs text-faint">
        Город
        <input
          className="field mt-1"
          value={open === "city" ? cityQuery : city}
          placeholder={selected ? "Найдите город" : "Сначала выберите страну"}
          disabled={!selected}
          onFocus={() => {
            setOpen("city");
            setCityQuery("");
          }}
          onChange={(event) => lookCities(event.target.value)}
        />
      </label>
      {open === "city" && selected ? (
        <ul className="max-h-48 overflow-y-auto rounded-2xl border border-line bg-bg">
          {(cities ?? []).map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="press block w-full px-3 py-2 text-left text-sm hover:bg-subtle"
                onClick={() => {
                  onCity(row.name);
                  setOpen(null);
                }}
              >
                {row.name}
                {row.region ? <span className="mt-0.5 block text-xs text-faint">{row.region}</span> : null}
              </button>
            </li>
          ))}
          {cityQuery.trim().length < 2 ? <li className="px-3 py-2 text-xs text-faint">Введите хотя бы две буквы</li> : null}
          {cityQuery.trim().length >= 2 && cities && cities.length === 0 ? <li className="px-3 py-2 text-xs text-faint">Город не нашёлся</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
