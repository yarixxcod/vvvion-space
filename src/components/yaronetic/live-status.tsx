import { useEffect, useState } from "react";

const LINES = [
  "Думаю…",
  "Размышляю…",
  "Ищу…",
  "Собираю мысль…",
  "Сверяю…",
  "Прикидываю…",
  "Смотрю вокруг…",
  "Вспоминаю…",
  "Соединяю…",
  "Уточняю…",
  "Перебираю…",
  "Складываю…",
  "Набрасываю…",
  "Рисую…",
  "Подбираю тон…",
  "Читаю следы…",
  "Держу нить…",
  "Пробую иначе…",
  "Сопоставляю…",
  "Ловлю суть…",
  "Смотрю шире…",
  "Тихо считаю…",
  "Ловлю свет…",
  "Перечитываю…",
];

export function LiveLine({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(Math.floor(Math.random() * LINES.length));
    const timer = window.setInterval(() => {
      setIndex(Math.floor(Math.random() * LINES.length));
    }, 1700);
    return () => window.clearInterval(timer);
  }, []);
  return <span className={className}>{LINES[index]}</span>;
}
