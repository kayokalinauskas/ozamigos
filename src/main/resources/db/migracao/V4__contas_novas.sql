-- O teto de contas novas por hora (Contas.contasNovasPorHora) conta as contas criadas na última hora a cada conta nova:
-- com o índice, a contagem não lê a tabela inteira dentro da transação do login.
create index usuarios_criado_em on usuarios (criado_em);
