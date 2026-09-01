---
impacto: nada_mudou
secao: corrigido
titulo: Duas falhas de segurança conhecidas saíram das dependências
---

O `pnpm audit` acusava duas falhas de severidade alta numa biblioteca que o
sistema usa para montar o site (`browserslist`). Ela entrou de carona por outra
dependência, e não estava listada diretamente — por isso não saía com uma
atualização comum.

Nenhuma das duas era alcançável por quem usa o sistema: a biblioteca só roda na
hora de montar a imagem, não no servidor que atende cliente. Ainda assim, ficar
com advisory aberto é dívida — quem audita a instalação vê o alerta e não tem
como saber, do relatório, que ele não alcança nada.

**Quem já roda numa VPS não precisa fazer nada.**
