import { expect, it } from "vitest";
import {
  filterStories,
  isCapturedByChromatic,
  parseDeviceScaleFactor,
  parseGlobals,
  parseViewports,
  planCaptures,
  type SettleOptions,
  type Story,
  settleStory,
  shardStories,
  storybookCommand,
  storySnapshotName,
  storyUrl,
} from "./storybook";

const stories: Story[] = [
  {
    id: "button--primary",
    title: "Components/Button",
    name: "Primary",
    tags: ["dev", "snapshot"],
  },
  { id: "button--secondary", title: "Components/Button", name: "Secondary" },
  { id: "home--default", title: "Pages/Home", name: "Default" },
];

it("filters stories by title and name globs", () => {
  expect(
    filterStories(stories, "Components/**", undefined).map((s) => s.id),
  ).toEqual(["button--primary", "button--secondary"]);
  expect(
    filterStories(stories, undefined, "*/Button/Secondary").map((s) => s.id),
  ).toEqual(["button--primary", "home--default"]);
  expect(filterStories(stories, "Pages/*", undefined)).toEqual([]);
});

it("filters stories by tag", () => {
  expect(
    filterStories(stories, undefined, undefined, "snapshot").map((s) => s.id),
  ).toEqual(["button--primary"]);
});

it("splits stories between shards", () => {
  const ids = (index: number) =>
    shardStories(stories, { index, total: 2 }).map((s) => s.id);
  expect(ids(1)).toEqual(["button--primary", "home--default"]);
  expect(ids(2)).toEqual(["button--secondary"]);
  expect(shardStories(stories, { index: null, total: null })).toEqual(stories);
});

it("names a story snapshot after its title, name and viewport", () => {
  expect(storySnapshotName(stories[0] as Story, 375)).toBe(
    "Components/Button/Primary [chromium 375]",
  );
});

it("opens a story with its Storybook globals", () => {
  const story = stories[0] as Story;
  expect(storyUrl("http://127.0.0.1:6006", story, undefined)).toBe(
    "http://127.0.0.1:6006/iframe.html?id=button--primary&viewMode=story",
  );
  expect(storyUrl("http://127.0.0.1:6006", story, "brand:new;theme:dark")).toBe(
    "http://127.0.0.1:6006/iframe.html?id=button--primary&viewMode=story&globals=brand%3Anew%3Btheme%3Adark",
  );
});

it("picks the stories Chromatic captures", () => {
  const story = stories[0] as Story;
  expect(isCapturedByChromatic(story)).toBe(true);
  expect(
    isCapturedByChromatic({ ...story, chromatic: { disableSnapshot: false } }),
  ).toBe(true);
  expect(
    isCapturedByChromatic({ ...story, chromatic: { disableSnapshot: true } }),
  ).toBe(false);
  expect(
    isCapturedByChromatic({ ...story, chromatic: { disable: true } }),
  ).toBe(false);
});

it("captures each enabled Chromatic mode with its width and globals", () => {
  const story: Story = {
    ...(stories[0] as Story),
    chromatic: {
      delay: 300,
      modes: {
        "current 720px": { viewport: 720, brand: "current" },
        "hues 720px": { viewport: 720, brand: "hues" },
        "hues 1120px": { disable: true },
        mobile: { viewport: "small", dark: true },
        default: { brand: "hues" },
      },
    },
    namedViewports: { small: 375 },
  };
  const captures = planCaptures([story], {
    viewports: [1280, 375],
    globals: "theme:light;brand:old",
    chromatic: true,
    delay: 0,
  });
  expect(
    captures.map(({ name, width, globals, delay }) => ({
      name,
      width,
      globals,
      delay,
    })),
  ).toEqual([
    {
      name: "Components/Button/Primary [chromium current 720px]",
      width: 720,
      globals: "theme:light;brand:current",
      delay: 300,
    },
    {
      name: "Components/Button/Primary [chromium hues 720px]",
      width: 720,
      globals: "theme:light;brand:hues",
      delay: 300,
    },
    {
      name: "Components/Button/Primary [chromium mobile]",
      width: 375,
      globals: "theme:light;brand:old;dark:!true",
      delay: 300,
    },
    {
      name: "Components/Button/Primary [chromium default]",
      width: 1280,
      globals: "theme:light;brand:hues",
      delay: 300,
    },
  ]);
});

it("uses Chromatic viewports, or the flags, for stories without modes", () => {
  const story: Story = {
    ...(stories[0] as Story),
    chromatic: { viewports: [320] },
  };
  const names = (chromatic: boolean) =>
    planCaptures([story], { viewports: [1280], chromatic, delay: 0 }).map(
      (capture) => capture.name,
    );
  expect(names(true)).toEqual(["Components/Button/Primary [chromium 320]"]);
  expect(names(false)).toEqual(["Components/Button/Primary [chromium 1280]"]);
});

it("refuses a mode viewport that is not a width", () => {
  expect(() =>
    planCaptures(
      [
        {
          ...(stories[0] as Story),
          chromatic: { modes: { tablet: { viewport: "ipad" } } },
        },
      ],
      { viewports: [1280], chromatic: true, delay: 0 },
    ),
  ).toThrow('mode "tablet" has viewport "ipad", which is not a width');
});

it("parses viewport widths", () => {
  expect(parseViewports("375, 1280")).toEqual([375, 1280]);
  expect(() => parseViewports("wide")).toThrow("Must look like 375,1280.");
});

it("parses Storybook globals", () => {
  expect(parseGlobals("brand:new;theme:dark")).toBe("brand:new;theme:dark");
  expect(() => parseGlobals("brand")).toThrow(
    "Must look like brand:new;theme:dark.",
  );
});

it("parses the device scale factor", () => {
  expect(parseDeviceScaleFactor("2")).toBe(2);
  expect(parseDeviceScaleFactor("1.5")).toBe(1.5);
  expect(() => parseDeviceScaleFactor("0")).toThrow(
    "Must be a number above 0, like 2.",
  );
});

it("refuses --shard auto, which cannot split stories", async () => {
  await expect(
    storybookCommand("storybook-static", {
      shard: { index: null, total: null },
      viewports: [1280],
      waitForSelector: "#storybook-root",
      waitForNetworkIdle: true,
      delay: 0,
    } as Parameters<typeof storybookCommand>[1]),
  ).rejects.toThrow(/--shard i\/n/);
});

function fakePage(networkIdle: () => Promise<void> = async () => {}) {
  const calls: string[] = [];
  const page = {
    waitForSelector: async (selector: string) => {
      calls.push(`selector ${selector}`);
      return null;
    },
    evaluate: async (expression: string) => {
      calls.push(
        expression.includes("requestAnimationFrame")
          ? "two frames"
          : expression,
      );
    },
    waitForLoadState: async (state: string) => {
      calls.push(state);
      await networkIdle();
    },
    waitForTimeout: async (ms: number) => {
      calls.push(`delay ${ms}`);
    },
  } as unknown as Parameters<typeof settleStory>[0];
  return { page, calls };
}

const settle: SettleOptions = {
  waitForSelector: "#storybook-root > *",
  waitForNetworkIdle: true,
  delay: 0,
};

it("waits for fonts, the network and two frames, then the delay", async () => {
  const { page, calls } = fakePage();
  await settleStory(page, "Diff/Pane", { ...settle, delay: 200 });
  expect(calls).toEqual([
    "selector #storybook-root > *",
    "document.fonts.ready",
    "networkidle",
    "two frames",
    "delay 200",
  ]);
});

it("skips the network wait with --no-wait-for-network-idle", async () => {
  const { page, calls } = fakePage();
  await settleStory(page, "Diff/Pane", {
    ...settle,
    waitForNetworkIdle: false,
  });
  expect(calls).not.toContain("networkidle");
  expect(calls).toContain("two frames");
});

it("warns and captures anyway when the network never goes idle", async () => {
  const { page, calls } = fakePage(async () => {
    const error = new Error("Timeout 5000ms exceeded.");
    error.name = "TimeoutError";
    throw error;
  });
  const warnings: string[] = [];
  await settleStory(page, "Live/Polling", settle, (message) =>
    warnings.push(message),
  );
  expect(warnings).toEqual([
    "stateofpixel  Live/Polling: network still busy after 5s, capturing anyway",
  ]);
  expect(calls.at(-1)).toBe("two frames");
});

it("fails the story on other network wait errors", async () => {
  const { page } = fakePage(async () => {
    throw new Error("Target page, context or browser has been closed");
  });
  await expect(
    settleStory(page, "Diff/Pane", settle, () => {}),
  ).rejects.toThrow("has been closed");
});
