import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JanelaFechadaAviso } from "@/components/inbox/JanelaFechadaAviso";
import { JanelaSelo } from "@/components/inbox/JanelaSelo";
import {
  CHANNEL_PROVIDER_INSTAGRAM,
  CHANNEL_PROVIDER_ZERNIO,
} from "@/lib/channels/capabilities";
import { saidaDaJanelaFechada } from "@/lib/channels/janela";

/**
 * JANELA FECHADA NUM CANAL SEM MODELO — o que a pessoa do atendimento vê.
 *
 * O aviso nasceu para o WhatsApp oficial, onde fora das 24h a saída é mandar um
 * modelo aprovado. Num canal sem modelo (o Instagram) `fonteDeTemplates` é `null`:
 * a lista nunca carrega, e o aviso caía no ramo "nenhum modelo aprovado ainda —
 * crie um em Conexões → Templates". Instrução impossível: não há modelo a criar
 * para este canal. A saída real é esperar o cliente escrever de novo (a exceção
 * humana de 7 dias da plataforma NÃO é modelada, de propósito).
 */

const get = vi.fn(async () => ({ data: { templates: [] } }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: (...a: unknown[]) => get(...(a as [])) } }));
vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

function montar(provider: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <JanelaFechadaAviso conversationId="c1" provider={provider} motivo="A janela de 24h fechou há 3d." />
    </QueryClientProvider>,
  );
}

describe("a saída que existe depende do canal — decidida no seam", () => {
  it("canal COM modelo: a saída é o modelo; SEM modelo: esperar o cliente", () => {
    expect(saidaDaJanelaFechada(CHANNEL_PROVIDER_ZERNIO)).toBe("modelo");
    expect(saidaDaJanelaFechada(CHANNEL_PROVIDER_INSTAGRAM)).toBe("aguardar_cliente");
  });
});

describe("JanelaFechadaAviso sem fonte de modelos", () => {
  it("não manda criar modelo, não mostra seletor, e diz que é preciso esperar o cliente", () => {
    get.mockClear();
    montar(CHANNEL_PROVIDER_INSTAGRAM);
    expect(screen.queryByText(/Nenhum modelo aprovado/i)).toBeNull();
    expect(screen.queryByText(/Conexões → Templates/)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/não tem modelo aprovado/i)).toBeInTheDocument();
    expect(screen.getByText(/cliente escrever de novo/i)).toBeInTheDocument();
    // E não pergunta por modelos a rota nenhuma.
    expect(get).not.toHaveBeenCalled();
  });

  it("canal COM fonte, lista vazia: segue orientando a criar o modelo (controle)", async () => {
    get.mockClear();
    montar(CHANNEL_PROVIDER_ZERNIO);
    expect(await screen.findByText(/Nenhum modelo aprovado/i)).toBeInTheDocument();
  });
});

describe("o selo e o motivo do composer também não prometem modelo", () => {
  it("selo fechado no canal sem modelo: 'aguarde o cliente', não 'só modelo'", () => {
    render(
      <JanelaSelo
        provider={CHANNEL_PROVIDER_INSTAGRAM}
        lastInboundAt={new Date(Date.now() - 30 * 3_600_000).toISOString()}
      />,
    );
    expect(screen.queryByText(/só modelo/i)).toBeNull();
    expect(screen.getByText(/aguarde o cliente/i)).toBeInTheDocument();
  });

  it("o InboxLayout escolhe o texto do motivo pela saída do seam, não pelo provider", () => {
    const fonte = readFileSync("components/inbox/InboxLayout.tsx", "utf8");
    expect(fonte).toMatch(/saidaDaJanelaFechada\(/);
    expect(fonte).not.toMatch(/"instagram"|"meta_cloud"|"zernio"|"waha"/);
  });
});
