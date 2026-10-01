import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A tela de conectar o Instagram.
 *
 * ─── O defeito que estes casos existem para impedir ─────────────────────────
 *
 * Uma tela que fingisse saúde. "Não conectado" precisa ser um estado com nome e
 * consequência (nenhuma mensagem chega); "token inválido" não pode virar
 * "conectado" porque existe uma linha gravada; e segredo colado nunca pode ficar
 * no campo depois de gravado.
 */

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
  },
}));
const toastOk = vi.fn();
const toastErro = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastOk(m), error: (m: string) => toastErro(m) },
}));
const copiar = vi.fn(async (_v: string) => true);
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: (v: string) => copiar(v) }));

import { CanalInstagramForm } from "@/app/app/settings/canal-instagram/_form";

const URL_WEBHOOK = "https://crm.exemplo/api/v1/webhooks/channel/tok123abc";

const naoConectado = {
  data: { state: "nao_conectado", health: null, username: null, webhookUrl: null, verifyToken: null },
};
const conectado = {
  data: {
    state: "conectado",
    health: "ok",
    username: "loja_da_ana",
    webhookUrl: URL_WEBHOOK,
    verifyToken: "tok123abc",
  },
};

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  toastOk.mockReset();
  toastErro.mockReset();
  copiar.mockClear();
});

describe("estado inicial", () => {
  it("diz claramente que NÃO está conectado, com a consequência, e não mostra URL nem botão de testar", async () => {
    getMock.mockResolvedValue(naoConectado);
    render(<CanalInstagramForm />);
    expect(await screen.findByText("Não conectado")).toBeInTheDocument();
    expect(screen.getByTestId("aviso-nao-conectado")).toHaveTextContent(/nenhuma mensagem/i);
    expect(screen.queryByRole("button", { name: /testar conexão/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("valor-para-colar")).not.toBeInTheDocument();
    expect(screen.queryByText("Conectado")).not.toBeInTheDocument();
  });

  it("mostra o passo a passo", async () => {
    getMock.mockResolvedValue(naoConectado);
    render(<CanalInstagramForm />);
    expect(await screen.findByText("Crie um app na Meta.")).toBeInTheDocument();
    expect(screen.getByText("Gere o token do Instagram.")).toBeInTheDocument();
    expect(screen.getByText("Cole aqui e conecte.")).toBeInTheDocument();
  });

  it("o passo a passo é o do Instagram Login: produto, escopos, tester, App Secret e assinatura de messages", async () => {
    getMock.mockResolvedValue(naoConectado);
    render(<CanalInstagramForm />);
    await screen.findByText("Crie um app na Meta.");
    const passos = screen.getByText("Passo a passo").closest("div")!.textContent ?? "";
    expect(passos).toContain("Instagram API with Instagram Login");
    expect(passos).toContain("instagram_business_basic");
    expect(passos).toContain("instagram_business_manage_messages");
    expect(passos).toMatch(/testadora/i);
    expect(passos).toMatch(/segredo do app/i);
    expect(passos).toMatch(/campo messages/i);
    // Caminho Facebook Login: Página do Facebook não é necessária.
    expect(passos).not.toMatch(/vinculada a uma Página/i);
    expect(screen.queryByText("Ligue o Instagram à Página.")).not.toBeInTheDocument();
  });

  it("avisa, sempre visível, que o modo de teste do CRM silencia a IA no Instagram", async () => {
    getMock.mockResolvedValue(naoConectado);
    render(<CanalInstagramForm />);
    const nota = await screen.findByTestId("nota-modo-teste");
    expect(nota).toHaveTextContent(
      "Com o modo de teste do CRM ativo a IA não responde no Instagram (o contato não tem telefone liberado); ative o go-live para testar.",
    );
  });

  it("credencial indisponível (falha nossa, não da Meta): mensagem própria, não 'Meta não respondeu'", async () => {
    getMock.mockResolvedValue({ data: { ...conectado.data, health: "credencial_indisponivel" } });
    render(<CanalInstagramForm />);
    expect(await screen.findByText(/não foi possível ler a credencial gravada/i)).toBeInTheDocument();
    expect(screen.queryByText(/não respondeu ao teste agora/i)).not.toBeInTheDocument();
  });

  it("conectado: mostra a conta, a URL e o verify token para copiar, e o botão de testar", async () => {
    getMock.mockResolvedValue(conectado);
    render(<CanalInstagramForm />);
    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(screen.getByText("@loja_da_ana")).toBeInTheDocument();
    const valores = screen.getAllByTestId("valor-para-colar").map((n) => n.textContent);
    expect(valores).toEqual([URL_WEBHOOK, "tok123abc"]);
    expect(screen.getByRole("button", { name: /testar conexão/i })).toBeInTheDocument();
  });

  it("token recusado pela Meta: aparece como inválido, NÃO como conectado", async () => {
    getMock.mockResolvedValue({ data: { ...conectado.data, state: "token_invalido", health: "falhou" } });
    render(<CanalInstagramForm />);
    expect(await screen.findByText("Token inválido")).toBeInTheDocument();
    expect(screen.getByTestId("aviso-token-invalido")).toBeInTheDocument();
    expect(screen.queryByText("Conectado")).not.toBeInTheDocument();
  });

  it("Meta sem resposta: admite que não testou, em vez de afirmar saúde", async () => {
    getMock.mockResolvedValue({ data: { ...conectado.data, health: "sem_resposta" } });
    render(<CanalInstagramForm />);
    expect(await screen.findByText(/não respondeu ao teste agora/i)).toBeInTheDocument();
  });

  it("falha ao ler o estado não trava a tela — o formulário continua servindo", async () => {
    getMock.mockRejectedValue(new Error("500"));
    render(<CanalInstagramForm />);
    expect(await screen.findByLabelText("Token de acesso")).toBeInTheDocument();
    expect(await screen.findByText("Não conectado")).toBeInTheDocument();
  });
});

describe("campos", () => {
  it("token e segredo são campos de senha, todos com rótulo, e o ID é numérico", async () => {
    getMock.mockResolvedValue(naoConectado);
    render(<CanalInstagramForm />);
    expect(await screen.findByLabelText("Token de acesso")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Segredo do app")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("ID da conta do Instagram")).toHaveAttribute("inputmode", "numeric");
  });

  it("os campos têm altura de toque de 44px (h-11) e o botão de conectar é um <button> alcançável", async () => {
    getMock.mockResolvedValue(naoConectado);
    render(<CanalInstagramForm />);
    for (const rotulo of ["ID da conta do Instagram", "Token de acesso", "Segredo do app"]) {
      expect((await screen.findByLabelText(rotulo)).className).toMatch(/\bh-11\b/);
    }
    const botao = screen.getByRole("button", { name: "Conectar" });
    expect(botao.className).toMatch(/\bh-11\b/);
    expect(botao).toHaveAttribute("type", "submit");
  });

  it("com conta conectada, o placeholder diz que já há valor gravado — nunca mostra qual", async () => {
    getMock.mockResolvedValue(conectado);
    render(<CanalInstagramForm />);
    const campo = await screen.findByLabelText("Token de acesso");
    await waitFor(() =>
      expect(campo).toHaveAttribute("placeholder", expect.stringMatching(/gravado/i)),
    );
    expect((campo as HTMLInputElement).value).toBe("");
  });
});

describe("conectar", () => {
  const preencher = async () => {
    fireEvent.change(await screen.findByLabelText("ID da conta do Instagram"), {
      target: { value: "17841400000000001" },
    });
    fireEvent.change(screen.getByLabelText("Token de acesso"), {
      target: { value: "EAAB_token_secreto_de_teste_0123456789" },
    });
    fireEvent.change(screen.getByLabelText("Segredo do app"), {
      target: { value: "segredo_do_app_meta_0123456789" },
    });
  };

  it("o botão fica desabilitado sem os três campos", async () => {
    getMock.mockResolvedValue(naoConectado);
    render(<CanalInstagramForm />);
    const botao = await screen.findByRole("button", { name: "Conectar" });
    expect(botao).toBeDisabled();
    await preencher();
    expect(botao).toBeEnabled();
  });

  it("envia os campos da API, carrega a URL e o verify token, e LIMPA token e segredo do campo", async () => {
    getMock.mockResolvedValueOnce(naoConectado).mockResolvedValue(conectado);
    postMock.mockResolvedValue({
      data: { webhookUrl: URL_WEBHOOK, verifyToken: "tok123abc", username: "loja_da_ana", status: "WORKING" },
    });
    render(<CanalInstagramForm />);
    await preencher();
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![0]).toBe("/api/v1/channels/instagram");
    expect(postMock.mock.calls[0]![1]).toEqual({
      accountId: "17841400000000001",
      accessToken: "EAAB_token_secreto_de_teste_0123456789",
      appSecret: "segredo_do_app_meta_0123456789",
    });

    await waitFor(() => expect(screen.getByLabelText("Token de acesso")).toHaveValue(""));
    expect(screen.getByLabelText("Segredo do app")).toHaveValue("");
    expect(await screen.findByText("Falta ligar a volta")).toBeInTheDocument();
    expect(toastOk).toHaveBeenCalledWith("Canal conectado.");
    // Nada do que foi colado reaparece em nenhum lugar do documento.
    expect(document.body.textContent).not.toContain("EAAB_token_secreto_de_teste_0123456789");
    expect(document.body.textContent).not.toContain("segredo_do_app_meta_0123456789");
  });

  it("webhookSubscribed=false: manda assinar o campo messages no painel da Meta", async () => {
    getMock.mockResolvedValueOnce(naoConectado).mockResolvedValue(conectado);
    postMock.mockResolvedValue({
      data: { webhookUrl: URL_WEBHOOK, verifyToken: "tok123abc", username: "l", status: "WORKING", webhookSubscribed: false },
    });
    render(<CanalInstagramForm />);
    await preencher();
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    const aviso = await screen.findByTestId("aviso-assinar-messages");
    expect(aviso).toHaveTextContent(/assine o campo messages/i);
  });

  it("webhookSubscribed=true: confirma a assinatura e não manda assinar à mão", async () => {
    getMock.mockResolvedValueOnce(naoConectado).mockResolvedValue(conectado);
    postMock.mockResolvedValue({
      data: { webhookUrl: URL_WEBHOOK, verifyToken: "tok123abc", username: "l", status: "WORKING", webhookSubscribed: true },
    });
    render(<CanalInstagramForm />);
    await preencher();
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    expect(await screen.findByText("Falta ligar a volta")).toBeInTheDocument();
    expect(screen.queryByTestId("aviso-assinar-messages")).not.toBeInTheDocument();
    expect(screen.getByTestId("assinatura-ok")).toBeInTheDocument();
  });

  it("recusa do servidor aparece na tela (role=alert) e NÃO marca como conectado", async () => {
    getMock.mockResolvedValue(naoConectado);
    postMock.mockRejectedValue(new Error("O ID informado não é o da conta deste token."));
    render(<CanalInstagramForm />);
    await preencher();
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    expect(await screen.findByTestId("erro-conectar")).toHaveTextContent(/ID informado/);
    expect(screen.getByTestId("erro-conectar")).toHaveAttribute("role", "alert");
    expect(screen.queryByText("Conectado")).not.toBeInTheDocument();
    // O que foi digitado continua lá para o operador corrigir.
    expect(screen.getByLabelText("Token de acesso")).toHaveValue(
      "EAAB_token_secreto_de_teste_0123456789",
    );
  });
});

describe("testar conexão e copiar", () => {
  it("'Testar conexão' pergunta de novo ao servidor e avisa o resultado", async () => {
    getMock.mockResolvedValue(conectado);
    render(<CanalInstagramForm />);
    fireEvent.click(await screen.findByRole("button", { name: /testar conexão/i }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith("Conexão funcionando."));
  });

  it("teste que encontra token recusado avisa erro, não sucesso", async () => {
    getMock.mockResolvedValueOnce(conectado).mockResolvedValue({
      data: { ...conectado.data, state: "token_invalido", health: "falhou" },
    });
    render(<CanalInstagramForm />);
    fireEvent.click(await screen.findByRole("button", { name: /testar conexão/i }));
    await waitFor(() => expect(toastErro).toHaveBeenCalled());
    expect(toastOk).not.toHaveBeenCalled();
  });

  it("os botões de copiar entregam o valor certo, e cada um tem nome próprio para leitor de tela", async () => {
    getMock.mockResolvedValue(conectado);
    render(<CanalInstagramForm />);
    fireEvent.click(await screen.findByRole("button", { name: /Copiar: Verify token/ }));
    await waitFor(() => expect(copiar).toHaveBeenCalledWith("tok123abc"));
    fireEvent.click(screen.getByRole("button", { name: /Copiar: URL de retorno/ }));
    await waitFor(() => expect(copiar).toHaveBeenCalledWith(URL_WEBHOOK));
  });
});

describe("validade do token e renovação", () => {
  const comToken = (extra: Record<string, unknown>) => ({
    data: { ...conectado.data, tokenValidoAte: null, diasRestantes: null, alertaToken: "desconhecido", ...extra },
  });

  it("token em dia: mostra a validade com a data e os dias, sem alerta", async () => {
    getMock.mockResolvedValue(
      comToken({ tokenValidoAte: "2026-11-15T15:00:00.000Z", diasRestantes: 45, alertaToken: "ok" }),
    );
    render(<CanalInstagramForm />);
    expect(await screen.findByTestId("validade-do-token")).toHaveTextContent("Token válido até 15/11/2026 (45 dias)");
    expect(screen.queryByTestId("aviso-token-vencendo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("aviso-token-expirado")).not.toBeInTheDocument();
  });

  it("1 dia restante usa o singular", async () => {
    getMock.mockResolvedValue(
      comToken({ tokenValidoAte: "2026-11-15T15:00:00.000Z", diasRestantes: 1, alertaToken: "vence_em_breve" }),
    );
    render(<CanalInstagramForm />);
    expect(await screen.findByTestId("validade-do-token")).toHaveTextContent("(1 dia)");
  });

  it("sem validade: diz que é desconhecida, sem inventar data", async () => {
    getMock.mockResolvedValue(comToken({}));
    render(<CanalInstagramForm />);
    expect(await screen.findByTestId("validade-do-token")).toHaveTextContent(/validade desconhecida/i);
    expect(screen.queryByTestId("aviso-token-vencendo")).not.toBeInTheDocument();
  });

  it("vence em breve: alerta com a ação (renovar agora)", async () => {
    getMock.mockResolvedValue(
      comToken({ tokenValidoAte: "2026-11-15T15:00:00.000Z", diasRestantes: 5, alertaToken: "vence_em_breve" }),
    );
    render(<CanalInstagramForm />);
    const aviso = await screen.findByTestId("aviso-token-vencendo");
    expect(aviso).toHaveAttribute("role", "alert");
    expect(aviso).toHaveTextContent(/Renovar token agora/);
  });

  it("expirado: manda gerar um token NOVO na Meta e colar em Reconectar", async () => {
    getMock.mockResolvedValue(
      comToken({ tokenValidoAte: "2026-09-01T15:00:00.000Z", diasRestantes: 0, alertaToken: "expirado" }),
    );
    render(<CanalInstagramForm />);
    const aviso = await screen.findByTestId("aviso-token-expirado");
    expect(aviso).toHaveTextContent(/token NOVO/);
    expect(aviso).toHaveTextContent(/Reconectar/);
    expect(screen.getByTestId("validade-do-token")).toHaveTextContent(/expirou/i);
  });

  it("o botão Renovar token agora tem altura de toque (>= 44px) e chama o endpoint, recarregando o estado", async () => {
    getMock.mockResolvedValue(comToken({ tokenValidoAte: "2026-11-15T15:00:00.000Z", diasRestantes: 5, alertaToken: "vence_em_breve" }));
    let resolver: (v: unknown) => void = () => undefined;
    postMock.mockImplementation(() => new Promise((r) => (resolver = r)));
    render(<CanalInstagramForm />);
    const botao = await screen.findByRole("button", { name: "Renovar token agora" });
    expect(botao.className).toMatch(/min-h-11|h-11/);
    fireEvent.click(botao);
    expect(await screen.findByRole("button", { name: /renovando/i })).toBeDisabled();
    expect(postMock).toHaveBeenCalledWith("/api/v1/channels/instagram/renovar-token", {});
    resolver({ data: { status: "renovado", tokenValidoAte: "2026-12-30T12:00:00.000Z", reason: "ok" } });
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith("Token renovado."));
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("novo demais / expirado / falhou: mostra a razão do servidor como erro, sem sucesso", async () => {
    getMock.mockResolvedValue(comToken({}));
    for (const status of ["novo_demais", "expirado", "falhou"]) {
      toastOk.mockReset();
      toastErro.mockReset();
      postMock.mockResolvedValueOnce({ data: { status, tokenValidoAte: null, reason: `razao ${status}` } });
      const { unmount } = render(<CanalInstagramForm />);
      fireEvent.click(await screen.findByRole("button", { name: "Renovar token agora" }));
      expect(await screen.findByTestId("resultado-renovacao")).toHaveTextContent(`razao ${status}`);
      expect(toastOk).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("falha de rede ao renovar: erro, e o botão volta a funcionar", async () => {
    getMock.mockResolvedValue(comToken({}));
    postMock.mockRejectedValue(new Error("Muitas tentativas. Aguarde um minuto."));
    render(<CanalInstagramForm />);
    fireEvent.click(await screen.findByRole("button", { name: "Renovar token agora" }));
    await waitFor(() => expect(toastErro).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Renovar token agora" })).toBeEnabled();
  });

  it("sem conexão não há botão de renovar", async () => {
    getMock.mockResolvedValue(naoConectado);
    render(<CanalInstagramForm />);
    await screen.findByText("Não conectado");
    expect(screen.queryByRole("button", { name: "Renovar token agora" })).not.toBeInTheDocument();
  });

  it("as instruções pedem token de longa duração e explicam a renovação diária e os 60 dias", async () => {
    getMock.mockResolvedValue(naoConectado);
    render(<CanalInstagramForm />);
    const nota = await screen.findByTestId("nota-validade-do-token");
    expect(nota).toHaveTextContent(/longa duração/i);
    expect(nota).toHaveTextContent(/todos os dias|todo dia/i);
    expect(nota).toHaveTextContent(/60 dias/);
  });
});
