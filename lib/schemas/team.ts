/**
 * EPIC-09 Team & Permissions — Zod schemas for invite, accept, role change, and api token.
 *
 * Roles are stored as `text` with a check constraint (not enum) on
 * `user_organizations.role` per project doctrine — keep this list in sync
 * with the DB constraint when adding/removing roles.
 */
import { z } from "zod";
import { interfaceSettingsSchema, interfaceTemDestino } from "@/lib/navigation/interface";

export const ROLES = ["viewer", "agent", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const inviteMemberSchema = z.object({
  invitations: z
    .array(
      z
        .object({
          email: z.string().email(),
          role: z.enum(ROLES),
          interface_settings: interfaceSettingsSchema.optional(),
        })
        .refine((v) => !v.interface_settings || interfaceTemDestino(v.interface_settings, v.role), {
          message: "Selecione ao menos uma área permitida ao papel.",
          path: ["interface_settings"],
        }),
    )
    .min(1)
    .max(20),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(ROLES),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

/**
 * Prefixos de escopo que SÓ o sistema emite. `deriveActor` (`lib/mcp/auth.ts`)
 * lê `actor:ai_agent` e `agent_run:<uuid>` para decidir quem aparece como autor
 * — coluna com FK e trilha de auditoria. Quem cria token por este schema é um
 * admin do tenant; deixá-lo gravar esses escopos é deixar um token comum se
 * passar por agente de IA. Quem os emite de verdade é
 * `lib/ai/runtime/mcp_token.ts`, direto no banco, sem passar por aqui.
 *
 * Gate por PREFIXO, e não por lista de permitidos: a tela manda `mcp:*`,
 * `role:manager`, `contacts:*`, `leads:*`, `messages:*` e `audit:read`, e um
 * escopo de integração que ninguém catalogou continua válido. Comparação sem
 * caixa e sem espaço em volta, para o gate não depender de como o leitor
 * (`deriveActor`) normalize amanhã.
 */
const PREFIXOS_DE_ESCOPO_RESERVADOS = ["actor:", "agent_run:"] as const;

const escopoReservadoAoSistema = (escopo: string): boolean => {
  const normalizado = escopo.trim().toLowerCase();
  return PREFIXOS_DE_ESCOPO_RESERVADOS.some((prefixo) => normalizado.startsWith(prefixo));
};

export const createApiTokenSchema = z.object({
  name: z.string().min(2).max(100),
  scopes: z
    .array(
      z.string().refine((escopo) => !escopoReservadoAoSistema(escopo), {
        message:
          "Escopo reservado ao sistema: `actor:` e `agent_run:` só são emitidos pelo runtime de agentes.",
      }),
    )
    .min(1),
  expires_in_days: z.coerce.number().int().min(1).max(365).optional(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
