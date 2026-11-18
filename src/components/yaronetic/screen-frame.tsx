import { useEffect, useState, type SyntheticEvent } from "react";

export function youtubeId(thumb: string, embed: string): string {
  return /\/vi\/([^/]+)\//.exec(thumb)?.[1] || /embed\/([^/?]+)/.exec(embed)?.[1] || "";
}

export function useClipFrame(thumb: string, embed: string, provider: string) {
  const [src, setSrc] = useState(thumb);
  const [tall, setTall] = useState(false);
  useEffect(() => {
    setSrc(thumb);
    setTall(false);
    if (provider !== "youtube") return;
    const id = youtubeId(thumb, embed);
    if (!id) return;
    let dead = false;
    const probe = new Image();
    probe.referrerPolicy = "no-referrer";
    probe.onload = () => {
      if (dead || probe.naturalWidth < 1) return;
      if (probe.naturalHeight > probe.naturalWidth * 1.08) {
        setSrc(probe.src);
        setTall(true);
      }
    };
    probe.src = `https://i.ytimg.com/vi/${id}/oardefault.jpg`;
    return () => {
      dead = true;
    };
  }, [embed, provider, thumb]);
  return {
    src: src || thumb,
    tall,
    onLoad(event: SyntheticEvent<HTMLImageElement>) {
      const img = event.currentTarget;
      if (img.naturalWidth > 0 && img.naturalHeight > img.naturalWidth * 1.08) setTall(true);
    },
  };
}

export function frameClass(tall: boolean) {
  return tall
    ? "relative mx-auto block aspect-[9/16] max-h-[32rem] w-full max-w-[18rem] overflow-hidden bg-black"
    : "relative block aspect-video w-full overflow-hidden bg-black";
}

export function stageClass(tall: boolean) {
  return tall
    ? "relative aspect-[9/16] h-[min(82dvh,900px)] max-w-full bg-black"
    : "relative aspect-video w-full max-w-5xl bg-black";
}
