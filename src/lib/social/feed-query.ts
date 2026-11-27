export type FeedQuery = {
  query: string;
  after: string;
  before: string;
  sort: "newest" | "oldest" | "likes" | "replies";
  minLikes: number;
  likedOnly: boolean;
  offset: number;
};
export const FEED_PAGE_SIZE = 40;
export const EMPTY_FEED_QUERY: FeedQuery = {
  query: "",
  after: "",
  before: "",
  sort: "newest",
  minLikes: 0,
  likedOnly: false,
  offset: 0,
};
export function parseFeedQuery(input: unknown): FeedQuery {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const date = (v: unknown) => {
    if (v === undefined || v === "") return "";
    if (typeof v !== "string" || v.length > 40 || !Number.isFinite(Date.parse(v)))
      throw Error("Некорректная дата");
    return new Date(v).toISOString();
  };
  const after = date(row.after),
    before = date(row.before);
  if (after && before && after >= before) throw Error("Начало периода должно быть раньше конца");
  const sort = ["newest", "oldest", "likes", "replies"].includes(String(row.sort))
    ? (row.sort as FeedQuery["sort"])
    : "newest";
  return {
    query: typeof row.query === "string" ? row.query.trim().slice(0, 160) : "",
    after,
    before,
    sort,
    minLikes: Math.min(1000000, Math.max(0, Math.floor(Number(row.minLikes) || 0))),
    likedOnly: row.likedOnly === true,
    offset: Math.min(10000, Math.max(0, Math.floor(Number(row.offset) || 0))),
  };
}
export function feedSelect(userId: string, input: FeedQuery) {
  const q = parseFeedQuery(input);
  const values: unknown[] = [userId];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const where = ["p.parent_id is null", "p.hidden_at is null"];
  const visible = "regexp_replace(p.body, '<[^>]*>', ' ', 'g')";
  for (const word of q.query.split(/\s+/).filter(Boolean).slice(0, 8)) {
    if (word.startsWith("#") && word.length > 1) {
      const tag = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      where.push(`${visible} ~* ${param(`(^|[^[:alnum:]_])${tag}($|[^[:alnum:]_-])`)}`);
    } else where.push(`${visible} ilike ${param("%" + word.replace(/[\\%_]/g, "\\$&") + "%")}`);
  }
  if (q.after) where.push(`p.created_at >= ${param(q.after)}::timestamptz`);
  if (q.before) where.push(`p.created_at < ${param(q.before)}::timestamptz`);
  if (q.minLikes) where.push(`coalesce(c.likes,0) >= ${param(q.minLikes)}`);
  if (q.likedOnly) where.push("m.liked is true");
  const order = {
    newest: "p.created_at desc,p.id desc",
    oldest: "p.created_at asc,p.id asc",
    likes: "coalesce(c.likes,0) desc,p.created_at desc,p.id desc",
    replies: "coalesce(r.replies,0) desc,p.created_at desc,p.id desc",
  }[q.sort];
  return {
    values,
    sql: `select p.id,p.body,p.user_id,p.created_at::text as created_at,coalesce(u.name,'Участник') as author,u.image,coalesce(c.likes,0) as likes,m.liked,coalesce(r.replies,0) as replies
 from posts p left join "user" u on u.id=p.user_id
 left join (select post_id,count(*) as likes from post_likes group by post_id) c on c.post_id=p.id
 left join (select post_id,true as liked from post_likes where user_id=$1) m on m.post_id=p.id
 left join (select parent_id,count(*) as replies from posts where parent_id is not null and hidden_at is null group by parent_id) r on r.parent_id=p.id
 where ${where.join(" and ")} order by ${order} limit ${param(FEED_PAGE_SIZE + 1)} offset ${param(q.offset)}`,
  };
}
