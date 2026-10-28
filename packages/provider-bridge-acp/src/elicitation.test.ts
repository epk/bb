import type { PendingInteractionUserAnswer } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { planAcpElicitation } from "./elicitation.js";

function form(properties: Record<string, unknown>, message = "Pick a plan") {
  return {
    sessionId: "s1",
    mode: "form",
    message,
    requestedSchema: { type: "object", properties },
  };
}

function questions(plan: ReturnType<typeof planAcpElicitation>) {
  if (plan.kind !== "questions") {
    throw new Error(`expected questions, got ${JSON.stringify(plan)}`);
  }
  return plan;
}

describe("planAcpElicitation", () => {
  it("turns each field kind into a question and decodes the answers back to typed content", () => {
    const plan = questions(
      planAcpElicitation(
        form({
          strategy: {
            type: "string",
            title: "Strategy",
            description: "How far to go",
            enum: ["conservative", "balanced", "aggressive"],
          },
          targets: {
            type: "array",
            items: {
              anyOf: [
                { const: "web", title: "Web app" },
                { const: "cli", title: "CLI" },
              ],
            },
          },
          dryRun: { type: "boolean" },
          retries: { type: "integer", title: "Retries" },
        }),
      ),
    );

    expect(plan.payloads).toHaveLength(1);
    expect(plan.payloads[0]?.questions).toEqual([
      {
        id: "strategy",
        prompt: "Pick a plan\n\nStrategy\nHow far to go",
        shortLabel: "Strategy",
        multiSelect: false,
        options: [
          { value: "conservative", label: "conservative" },
          { value: "balanced", label: "balanced" },
          { value: "aggressive", label: "aggressive" },
        ],
        allowFreeText: false,
      },
      {
        id: "targets",
        prompt: "targets",
        shortLabel: "targets",
        multiSelect: true,
        options: [
          { value: "web", label: "Web app" },
          { value: "cli", label: "CLI" },
        ],
        allowFreeText: false,
      },
      {
        id: "dryRun",
        prompt: "dryRun",
        shortLabel: "dryRun",
        multiSelect: false,
        options: [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
        allowFreeText: false,
      },
      {
        id: "retries",
        prompt: "Retries\nEnter a whole number.",
        shortLabel: "Retries",
        multiSelect: false,
        allowFreeText: true,
      },
    ]);

    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: {
          strategy: { selected: ["balanced"] },
          targets: { selected: ["web", "cli"] },
          dryRun: { selected: ["false"] },
          retries: { selected: [], freeText: " 3 " },
        },
      }),
    ).toEqual({
      action: "accept",
      content: {
        strategy: "balanced",
        targets: ["web", "cli"],
        dryRun: false,
        retries: 3,
      },
    });
  });

  it("declines when an answer does not fit its field", () => {
    const plan = questions(
      planAcpElicitation(form({ retries: { type: "integer" } })),
    );
    for (const freeText of ["many", "2.5"]) {
      expect(
        plan.toResponse({
          kind: "user_answer",
          answers: { retries: { selected: [], freeText } },
        }),
      ).toEqual({ action: "decline" });
    }
    expect(plan.toResponse({ kind: "user_answer", answers: {} })).toEqual({
      action: "decline",
    });
  });

  it("asks for a typed answer when a choice has more options than the card can list, and matches it by value or label", () => {
    const plan = questions(
      planAcpElicitation(
        form({
          branch: {
            type: "string",
            oneOf: ["main", "dev", "release", "hotfix", "next"].map(
              (value) => ({ const: value, title: value.toUpperCase() }),
            ),
          },
        }),
      ),
    );
    expect(plan.payloads[0]?.questions[0]).toMatchObject({
      allowFreeText: true,
      prompt: "Pick a plan\n\nbranch\nOne of: MAIN, DEV, RELEASE, HOTFIX, NEXT",
    });
    expect(plan.payloads[0]?.questions[0]?.options).toBeUndefined();
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { branch: { selected: [], freeText: "Hotfix" } },
      }),
    ).toEqual({ action: "accept", content: { branch: "hotfix" } });
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { branch: { selected: [], freeText: "staging" } },
      }),
    ).toEqual({ action: "decline" });
  });

  it("shows a form without fields as accept or decline", () => {
    const plan = questions(planAcpElicitation(form({}, "Deploy now?")));
    expect(plan.payloads[0]?.questions).toMatchObject([
      {
        prompt: "Deploy now?",
        options: [{ label: "Accept" }, { label: "Decline" }],
      },
    ]);
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { confirm: { selected: ["accept"] } },
      }),
    ).toEqual({ action: "accept", content: {} });
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { confirm: { selected: ["decline"] } },
      }),
    ).toEqual({ action: "decline" });
  });

  it("answers a choice's `__other` field from the question's Other box instead of asking it separately", () => {
    const plan = questions(
      planAcpElicitation(
        form({
          q0: {
            type: "string",
            title: "Which runner?",
            oneOf: [
              { const: "Vitest", title: "Vitest" },
              { const: "Jest", title: "Jest" },
            ],
          },
          q0__other: { type: "string", title: "Other (type your own)" },
          q1: {
            type: "array",
            title: "Which suites?",
            items: { anyOf: [{ const: "unit" }, { const: "e2e" }] },
          },
          q1__other: { type: "string", title: "Other (type your own)" },
          notes__other: { type: "string", title: "Notes" },
        }),
      ),
    );
    expect(plan.payloads[0]?.questions).toMatchObject([
      { id: "q0", multiSelect: false, allowFreeText: true },
      { id: "q1", multiSelect: true, allowFreeText: true },
      { id: "notes__other", allowFreeText: true },
    ]);

    const answer = (
      q0: PendingInteractionUserAnswer,
      q1: PendingInteractionUserAnswer,
    ) =>
      plan.toResponse({
        kind: "user_answer",
        answers: { q0, q1, notes__other: { selected: [], freeText: "n" } },
      });
    expect(answer({ selected: ["Jest"] }, { selected: [] })).toEqual({
      action: "accept",
      content: { q0: "Jest", q1: [], notes__other: "n" },
    });
    expect(
      answer(
        { selected: [], freeText: " Mocha " },
        { selected: ["unit"], freeText: "smoke" },
      ),
    ).toEqual({
      action: "accept",
      content: {
        q0__other: "Mocha",
        q1: ["unit"],
        q1__other: "smoke",
        notes__other: "n",
      },
    });
    expect(answer({ selected: [] }, { selected: [] })).toEqual({
      action: "decline",
    });
  });

  it("keeps a typed answer that matches no option as the `__other` value", () => {
    const plan = questions(
      planAcpElicitation(
        form({
          branch: {
            type: "string",
            enum: ["main", "dev", "release", "hotfix", "next"],
          },
          branch__other: { type: "string" },
        }),
      ),
    );
    const answer = (freeText: string) =>
      plan.toResponse({
        kind: "user_answer",
        answers: { branch: { selected: [], freeText } },
      });
    expect(answer("DEV")).toEqual({
      action: "accept",
      content: { branch: "dev" },
    });
    expect(answer("staging")).toEqual({
      action: "accept",
      content: { branch__other: "staging" },
    });
  });

  it("splits more questions than a card shows into cards of four, and answers once from all of them", () => {
    const names = ["a", "b", "c", "d", "e"];
    const plan = questions(
      planAcpElicitation(
        form(
          Object.fromEntries(names.map((name) => [name, { type: "string" }])),
          "Five things",
        ),
      ),
    );
    expect(
      plan.payloads.map((payload) =>
        payload.questions.map((question) => question.prompt),
      ),
    ).toEqual([["Five things\n\na", "b", "c", "d"], ["Five things\n\ne"]]);
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: Object.fromEntries(
          names.map((name) => [name, { selected: [], freeText: name }]),
        ),
      }),
    ).toEqual({
      action: "accept",
      content: { a: "a", b: "b", c: "c", d: "d", e: "e" },
    });
  });

  it("refuses forms it cannot show, with the reason", () => {
    expect(
      planAcpElicitation({ mode: "url", url: "https://example.com" }),
    ).toEqual({
      kind: "unsupported",
      reason: 'bb does not offer the "url" elicitation mode',
    });
    expect(planAcpElicitation(form({ nested: { type: "object" } }))).toEqual({
      kind: "unsupported",
      reason: 'bb cannot show the field "nested"',
    });
  });
});
