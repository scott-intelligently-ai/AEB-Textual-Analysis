import { describe, expect, it } from "vitest";
import type { JevRequest } from "./jev";
import {
  occurrenceInstructions,
  settledToneId,
  suggestTones,
  TONE_SETTLED_AT,
  toneCriteria,
  type ToneOption,
} from "./tone";

const tones: ToneOption[] = [
  { id: 1, name: "Positive", score: 1, isDefault: false, definition: "Warm approval." },
  { id: 2, name: "Neutral", score: 0, isDefault: true, definition: null },
  { id: 3, name: "Negative", score: -1, isDefault: false, definition: "  " },
];

function answer(choice: string, probability: number) {
  const rest = (1 - probability) / 2;
  return {
    type: "choice",
    choice,
    confidence: probability,
    probabilities: { Positive: rest, Neutral: rest, Negative: rest, [choice]: probability },
  };
}

describe("settledToneId", () => {
  it("keeps the winner only at or above the threshold", () => {
    expect(settledToneId(answer("Positive", TONE_SETTLED_AT), tones)).toBe(1);
    expect(settledToneId(answer("Negative", TONE_SETTLED_AT - 0.01), tones)).toBeNull();
  });

  it("leaves a missing, malformed, or unknown answer unset", () => {
    expect(settledToneId(undefined, tones)).toBeNull();
    expect(settledToneId({ choice: "Positive" }, tones)).toBeNull();
    expect(settledToneId(answer("Mixed", 0.9), tones)).toBeNull();
    expect(settledToneId({ choice: "Positive", probabilities: { Positive: "high" } }, tones)).toBeNull();
  });
});

describe("suggestTones", () => {
  const text = "We want peace. We fear war.";
  const targets = [
    { start: text.indexOf("peace"), end: text.indexOf("peace") + "peace".length },
    { start: text.indexOf("war"), end: text.indexOf("war") + "war".length },
  ];

  it("asks one choice per occurrence and drops an unsettled answer", async () => {
    const seen: JevRequest[] = [];
    const result = await suggestTones({
      text,
      targets,
      tones,
      purpose: " Campaign speeches ",
      ask: async (request) => {
        seen.push(request);
        return {
          occurrence_1: answer("Positive", 0.82),
          occurrence_2: answer("Negative", 0.5),
        };
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].state.passage).toContain('<term n="1">peace</term>');
    expect(seen[0].state.passage).toContain('<term n="2">war</term>');
    expect(seen[0].state.purpose).toBe("Campaign speeches");
    expect(seen[0].questions.occurrence_1).toMatchObject({
      type: "choice",
      instructions: occurrenceInstructions(1, true),
      criteria: toneCriteria(tones),
    });
    expect(seen[0].questions.occurrence_2).toMatchObject({
      instructions: occurrenceInstructions(2, true),
    });
    expect(toneCriteria(tones)).toEqual({
      Positive: "Warm approval.",
      Neutral: null,
      Negative: null,
    });
    expect(result).toEqual({
      suggestions: [{ start: targets[0].start, end: targets[0].end, toneId: 1, reason: "" }],
      missed: 1,
    });
  });

  it("does not mention a purpose that was not given", async () => {
    let instructions = "";
    await suggestTones({
      text,
      targets: [targets[0]],
      tones,
      ask: async (request) => {
        instructions = String(request.questions.occurrence_1.instructions);
        expect(request.state.purpose).toBeUndefined();
        return { occurrence_1: answer("Neutral", 0.91) };
      },
    });
    expect(instructions).toBe(occurrenceInstructions(1, false));
    expect(instructions).not.toContain("`purpose`");
  });

  it("does not call Jev when there is nothing to judge", async () => {
    const ask = async () => {
      throw new Error("should not be called");
    };
    await expect(suggestTones({ text, targets: [], tones, ask })).resolves.toEqual({
      suggestions: [],
      missed: 0,
    });
    await expect(suggestTones({ text, targets, tones: [], ask })).rejects.toThrow(/at least one tone/);
  });

  it("lets a failed call throw instead of inventing an answer", async () => {
    await expect(
      suggestTones({
        text,
        targets,
        tones,
        ask: async () => {
          throw new Error("Jev is down");
        },
      }),
    ).rejects.toThrow("Jev is down");
  });
});
