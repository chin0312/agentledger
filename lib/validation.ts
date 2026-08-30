import { z } from "zod";

import { financialPolicySchema, MAX_FINANCIAL_VALUE } from "./policy";

const daysSchema = z.number().int("days must be an integer").min(1, "days must be at least 1").max(90, "days must be at most 90");
const transactionCountSchema = (field: string) =>
  z.number().int(`${field} must be an integer`).finite(`${field} must be finite`).min(0, `${field} must be greater than or equal to zero`).max(1_000_000, `${field} is unreasonably large`);
const financialValueSchema = (field: string) =>
  z.number().finite(`${field} must be finite`).min(0, `${field} must be greater than or equal to zero`).max(MAX_FINANCIAL_VALUE, `${field} is unreasonably large`);

const providedFinancialStateSchema = z
  .object({
    periodDays: daysSchema,
    cashFlow: z
      .object({
        inflows: financialValueSchema("financialState.cashFlow.inflows"),
        outflows: financialValueSchema("financialState.cashFlow.outflows"),
        incomingTransactions: transactionCountSchema("financialState.cashFlow.incomingTransactions").optional(),
        outgoingTransactions: transactionCountSchema("financialState.cashFlow.outgoingTransactions").optional(),
      })
      .strict(),
    spendVelocity: z
      .object({
        firstHalf: financialValueSchema("financialState.spendVelocity.firstHalf"),
        secondHalf: financialValueSchema("financialState.spendVelocity.secondHalf"),
      })
      .strict()
      .optional(),
    providers: z
      .array(
        z
          .object({
            provider: z.string().trim().min(1, "financialState.providers.provider is required").max(256, "financialState.providers.provider is too long"),
            spend: financialValueSchema("financialState.providers.spend"),
            transactions: transactionCountSchema("financialState.providers.transactions"),
            failedTransactions: transactionCountSchema("financialState.providers.failedTransactions").optional(),
          })
          .strict()
          .superRefine((provider, context) => {
            if ((provider.failedTransactions ?? 0) > provider.transactions) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["failedTransactions"],
                message: "financialState.providers.failedTransactions must not exceed transactions",
              });
            }
          }),
      )
      .max(100, "financialState.providers must contain at most 100 entries")
      .optional(),
    failedTransactions: transactionCountSchema("financialState.failedTransactions").optional(),
  })
  .strict();

export const companyHealthSchema = z
  .object({
    source: z.enum(["provided_state", "okx"]).optional(),
    address: z.string().trim().min(1, "address must not be empty").max(256, "address is too long").optional(),
    days: daysSchema.optional(),
    monthlyBudget: financialValueSchema("monthlyBudget").optional(),
    policy: financialPolicySchema.optional(),
    financialState: providedFinancialStateSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const isProvidedState = value.source === "provided_state" || (value.source !== "okx" && Boolean(value.financialState));
    if (isProvidedState && !value.financialState) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["financialState"], message: "financialState is required for provided_state requests" });
    }
    if (!isProvidedState && !value.address) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["address"], message: "address is required for OKX wallet requests" });
    }
    if (value.source === "okx" && value.financialState) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["financialState"], message: "financialState cannot be combined with source=okx" });
    }
    if (isProvidedState && value.days !== undefined && value.financialState && value.days !== value.financialState.periodDays) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["days"], message: "days must match financialState.periodDays" });
    }
  });

export const canISpendSchema = z.object({
  address: z.string().trim().min(1, "address is required"),
  proposedSpend: z.number().finite("proposedSpend must be finite").min(0, "proposedSpend must be greater than or equal to zero").max(MAX_FINANCIAL_VALUE, "proposedSpend is unreasonably large"),
  monthlyBudget: z.number().finite("monthlyBudget must be finite").min(0, "monthlyBudget must be greater than or equal to zero").max(MAX_FINANCIAL_VALUE, "monthlyBudget is unreasonably large"),
  days: daysSchema.optional().default(30),
  vendor: z.string().trim().min(1, "vendor must not be empty").optional(),
});

const nonNegativeNumber = (field: string) =>
  z.number().finite(`${field} must be finite`).min(0, `${field} must be greater than or equal to zero`).max(MAX_FINANCIAL_VALUE, `${field} is unreasonably large`);

export const canIAllocateSchema = z.object({
  agent: z.string().trim().min(1, "agent is required"),
  strategy: z.string().trim().min(1, "strategy is required"),
  proposedCapital: nonNegativeNumber("proposedCapital"),
  currentStrategyAllocation: nonNegativeNumber("currentStrategyAllocation"),
  totalCapital: nonNegativeNumber("totalCapital"),
  strategyCapitalLimit: nonNegativeNumber("strategyCapitalLimit"),
  dailyLossUsed: nonNegativeNumber("dailyLossUsed"),
  dailyLossLimit: nonNegativeNumber("dailyLossLimit"),
});

const servicePurchaseActionSchema = z.object({
  type: z.literal("service_purchase"),
  amount: nonNegativeNumber("action.amount"),
  provider: z.string().trim().min(1, "action.provider is required"),
});

const capitalAllocationActionSchema = z.object({
  type: z.literal("capital_allocation"),
  amount: nonNegativeNumber("action.amount"),
  strategy: z.string().trim().min(1, "action.strategy is required"),
});

const capitalStateSchema = z.object({
  currentStrategyAllocation: nonNegativeNumber("state.currentStrategyAllocation"),
  totalCapital: nonNegativeNumber("state.totalCapital"),
  dailyLossUsed: nonNegativeNumber("state.dailyLossUsed"),
});

export const evaluateActionSchema = z
  .object({
    entity: z.string().trim().min(1, "entity is required"),
    action: z.discriminatedUnion("type", [servicePurchaseActionSchema, capitalAllocationActionSchema]),
    source: z.enum(["provided_state", "okx"]).optional(),
    financialState: providedFinancialStateSchema.optional(),
    context: z.object({ days: daysSchema.optional().default(30) }).optional(),
    state: capitalStateSchema.optional(),
    policy: financialPolicySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action.type === "capital_allocation" && !value.state) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "state is required for capital_allocation actions",
      });
    }
    if (value.action.type === "capital_allocation" && value.financialState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["financialState"],
        message: "financialState is only supported for service_purchase actions",
      });
    }
    if (value.source === "provided_state" && !value.financialState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["financialState"],
        message: "financialState is required for source=provided_state",
      });
    }
    if (value.source === "okx" && value.financialState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["financialState"],
        message: "financialState cannot be combined with source=okx",
      });
    }
    if (value.context?.days !== undefined && value.financialState && value.context.days !== value.financialState.periodDays) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["context", "days"],
        message: "context.days must match financialState.periodDays",
      });
    }
  });

export type CompanyHealthInput = z.infer<typeof companyHealthSchema>;
export type CanISpendInput = z.infer<typeof canISpendSchema>;
export type CanIAllocateInput = z.infer<typeof canIAllocateSchema>;
export type EvaluateActionInput = z.infer<typeof evaluateActionSchema>;
