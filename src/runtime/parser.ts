import { CompileError, type LexResult, type Token } from './lexer';

export interface TypeSpec {
  base: string; // e.g., 'int', 'double', 'char', 'bool', 'void', 'string', 'vector', 'auto', struct name
  templateArgs?: TypeSpec[];
  pointerDepth: number;
  isRef: boolean;
  isConst: boolean;
  isUnsigned?: boolean;
}

export interface ParamDecl {
  type: TypeSpec;
  name: string;
  isArray?: boolean;
  defaultValue?: Expr;
}

export interface ProgramNode {
  declarations: TopLevelDecl[];
  includes: string[];
}

export type TopLevelDecl =
  | FunctionDecl
  | VarDeclStmt
  | StructDecl;

export interface FunctionDecl {
  kind: 'function';
  returnType: TypeSpec;
  name: string;
  params: ParamDecl[];
  body: BlockStmt | null;
  line: number;
  column: number;
}

export interface StructDecl {
  kind: 'struct';
  name: string;
  fields: VarDeclItem[];
  methods: FunctionDecl[];
  line: number;
  column: number;
}

export type Stmt =
  | BlockStmt
  | VarDeclStmt
  | ExprStmt
  | IfStmt
  | ForStmt
  | RangeForStmt
  | WhileStmt
  | DoWhileStmt
  | SwitchStmt
  | ReturnStmt
  | BreakStmt
  | ContinueStmt
  | EmptyStmt;

export interface BlockStmt {
  kind: 'block';
  stmts: Stmt[];
  line: number;
  column: number;
}

export interface VarDeclItem {
  name: string;
  type: TypeSpec;
  arraySizes?: Expr[];
  init?: Expr;
  ctorArgs?: Expr[];
  line: number;
  column: number;
}

export interface VarDeclStmt {
  kind: 'vardecl';
  items: VarDeclItem[];
  line: number;
  column: number;
}

export interface ExprStmt {
  kind: 'expr';
  expr: Expr;
  line: number;
  column: number;
}

export interface IfStmt {
  kind: 'if';
  cond: Expr;
  thenBranch: Stmt;
  elseBranch?: Stmt;
  line: number;
  column: number;
}

export interface ForStmt {
  kind: 'for';
  init?: Stmt;
  cond?: Expr;
  update?: Expr;
  body: Stmt;
  line: number;
  column: number;
}

export interface RangeForStmt {
  kind: 'range_for';
  varType: TypeSpec;
  varName: string;
  iterable: Expr;
  body: Stmt;
  line: number;
  column: number;
}

export interface WhileStmt {
  kind: 'while';
  cond: Expr;
  body: Stmt;
  line: number;
  column: number;
}

export interface DoWhileStmt {
  kind: 'do_while';
  body: Stmt;
  cond: Expr;
  line: number;
  column: number;
}

export interface SwitchCase {
  test: Expr | null; // null => default
  stmts: Stmt[];
}

export interface SwitchStmt {
  kind: 'switch';
  discriminant: Expr;
  cases: SwitchCase[];
  line: number;
  column: number;
}

export interface ReturnStmt {
  kind: 'return';
  value?: Expr;
  line: number;
  column: number;
}

export interface BreakStmt {
  kind: 'break';
  line: number;
  column: number;
}

export interface ContinueStmt {
  kind: 'continue';
  line: number;
  column: number;
}

export interface EmptyStmt {
  kind: 'empty';
  line: number;
  column: number;
}

export type Expr =
  | { kind: 'number'; value: number; isFloat: boolean; line: number; column: number }
  | { kind: 'string'; value: string; line: number; column: number }
  | { kind: 'char'; value: string; line: number; column: number }
  | { kind: 'bool'; value: boolean; line: number; column: number }
  | { kind: 'null'; line: number; column: number }
  | { kind: 'ident'; name: string; line: number; column: number }
  | { kind: 'init_list'; elements: Expr[]; line: number; column: number }
  | { kind: 'unary'; op: string; arg: Expr; line: number; column: number }
  | { kind: 'postfix'; op: '++' | '--'; arg: Expr; line: number; column: number }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; line: number; column: number }
  | { kind: 'assign'; op: string; left: Expr; right: Expr; line: number; column: number }
  | { kind: 'ternary'; cond: Expr; thenExpr: Expr; elseExpr: Expr; line: number; column: number }
  | { kind: 'call'; callee: Expr; args: Expr[]; line: number; column: number }
  | { kind: 'index'; target: Expr; index: Expr; line: number; column: number }
  | { kind: 'member'; target: Expr; prop: string; isArrow: boolean; line: number; column: number }
  | { kind: 'cast'; targetType: TypeSpec; expr: Expr; line: number; column: number }
  | { kind: 'sizeof'; targetType?: TypeSpec; expr?: Expr; line: number; column: number }
  | { kind: 'new'; allocType: TypeSpec; count?: Expr; args?: Expr[]; line: number; column: number }
  | { kind: 'delete'; isArray: boolean; target: Expr; line: number; column: number };

const TYPE_STARTERS = new Set([
  'void', 'bool', 'char', 'short', 'int', 'long', 'float', 'double',
  'signed', 'unsigned', 'auto', 'const', 'constexpr', 'static', 'inline',
  'size_t', 'ssize_t', 'int64_t', 'uint64_t', 'int32_t', 'uint32_t',
  'string', 'vector', 'pair', 'struct', 'class',
]);

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

export function parseCpp(lex: LexResult, fileName: string): ProgramNode {
  const { tokens, includes, sourceLines } = lex;
  let pos = 0;
  const userTypes = new Set<string>();

  const peek = (offset = 0): Token => tokens[Math.min(pos + offset, tokens.length - 1)];
  const advance = (): Token => tokens[Math.min(pos++, tokens.length - 1)];

  const errorAt = (tok: Token, message: string): never => {
    throw new CompileError(fileName, tok.line, tok.column, message, sourceLines);
  };

  const isOpOrPunct = (tok: Token): boolean => tok.type === 'op' || tok.type === 'punct';
  const isSyntaxToken = (tok: Token): boolean =>
    tok.type === 'op' || tok.type === 'punct' || tok.type === 'keyword' || tok.type === 'ident';

  const match = (value: string): boolean => {
    const tok = peek();
    if (isSyntaxToken(tok) && tok.value === value) {
      advance();
      return true;
    }
    return false;
  };

  const expect = (value: string, message?: string): Token => {
    const tok = peek();
    if (!isSyntaxToken(tok) || tok.value !== value) {
      errorAt(tok, message ?? `expected '${value}' before '${tok.value || 'end of input'}'`);
    }
    return advance();
  };

  const isTypeStartAt = (idx: number): boolean => {
    const t = tokens[idx];
    if (!t || (t.type !== 'keyword' && t.type !== 'ident')) return false;
    if (t.value === 'std' && isOpOrPunct(tokens[idx + 1] ?? t) && tokens[idx + 1]?.value === '::') {
      const next = tokens[idx + 2];
      return Boolean(
        next &&
          (next.type === 'keyword' || next.type === 'ident') &&
          (TYPE_STARTERS.has(next.value) || userTypes.has(next.value))
      );
    }
    return TYPE_STARTERS.has(t.value) || userTypes.has(t.value);
  };

  const parseTypeSpec = (): TypeSpec => {
    let isConst = false;
    let isUnsigned = false;
    let base = '';
    let templateArgs: TypeSpec[] | undefined;

    while (
      peek().value === 'const' ||
      peek().value === 'constexpr' ||
      peek().value === 'static' ||
      peek().value === 'inline' ||
      peek().value === 'extern'
    ) {
      if (peek().value === 'const' || peek().value === 'constexpr') isConst = true;
      advance();
    }

    if (peek().value === 'struct' || peek().value === 'class') {
      advance();
    }

    if (peek().value === 'std' && peek(1).value === '::') {
      advance();
      advance();
    }

    if (peek().value === 'unsigned' || peek().value === 'signed') {
      isUnsigned = peek().value === 'unsigned';
      advance();
      if (
        peek().value === 'int' ||
        peek().value === 'long' ||
        peek().value === 'short' ||
        peek().value === 'char'
      ) {
        base = advance().value;
      } else {
        base = 'int';
      }
    } else if (peek().value === 'long' || peek().value === 'short') {
      base = advance().value;
      while (peek().value === 'long' || peek().value === 'int' || peek().value === 'double') {
        const next = advance().value;
        if (next === 'double') base = 'double';
        else if (next === 'long') base = 'long long';
      }
    } else {
      const tok = advance();
      if (tok.type !== 'keyword' && tok.type !== 'ident') {
        errorAt(tok, `expected type name before '${tok.value}'`);
      }
      base = tok.value;
    }

    // Template arguments like vector<int> or pair<int, double>
    if (peek().value === '<') {
      advance();
      templateArgs = [];
      if (peek().value !== '>') {
        do {
          templateArgs.push(parseTypeSpec());
        } while (match(','));
      }
      if (peek().value === '>>') {
        // Split `>>` into two `>` tokens for nested templates like vector<vector<int>>
        tokens[pos] = { ...peek(), value: '>' };
        tokens.splice(pos + 1, 0, {
          type: 'op',
          value: '>',
          line: peek().line,
          column: peek().column + 1,
        });
      }
      expect('>');
    }

    while (peek().value === 'const') {
      isConst = true;
      advance();
    }

    let pointerDepth = 0;
    while (peek().value === '*') {
      advance();
      pointerDepth += 1;
      while (peek().value === 'const') advance();
    }

    let isRef = false;
    if (peek().value === '&') {
      advance();
      isRef = true;
    }

    return { base, templateArgs, pointerDepth, isRef, isConst, isUnsigned };
  };

  // Detect whether current position starts a declaration (vs expression)
  const looksLikeVarDecl = (): boolean => {
    if (!isTypeStartAt(pos)) return false;
    // Handle `int(x)` functional cast vs `int x`
    const saved = pos;
    try {
      parseTypeSpec();
      const after = peek();
      const result = after.type === 'ident';
      pos = saved;
      return result;
    } catch {
      pos = saved;
      return false;
    }
  };

  const parseVarDeclStmt = (requireSemicolon = true): VarDeclStmt => {
    const startTok = peek();
    const baseType = parseTypeSpec();
    const items: VarDeclItem[] = [];

    let first = true;
    do {
      let itemType: TypeSpec = { ...baseType };
      if (!first) {
        // Subsequent declarators in `int a, *b;` reset pointer/ref from first declarator
        itemType = { ...baseType, pointerDepth: 0, isRef: false };
        while (peek().value === '*') {
          advance();
          itemType.pointerDepth += 1;
        }
        if (peek().value === '&') {
          advance();
          itemType.isRef = true;
        }
      }
      first = false;

      const nameTok = peek();
      if (nameTok.type !== 'ident') {
        errorAt(nameTok, `expected variable name before '${nameTok.value || 'end of input'}'`);
      }
      advance();

      const arraySizes: Expr[] = [];
      while (match('[')) {
        if (match(']')) {
          arraySizes.push({ kind: 'number', value: -1, isFloat: false, line: nameTok.line, column: nameTok.column });
        } else {
          arraySizes.push(parseExpr());
          expect(']');
        }
      }

      let init: Expr | undefined;
      let ctorArgs: Expr[] | undefined;

      if (match('=')) {
        init = parseAssignment();
      } else if (match('(')) {
        ctorArgs = [];
        if (peek().value !== ')') {
          do {
            ctorArgs.push(parseAssignment());
          } while (match(','));
        }
        expect(')');
      } else if (peek().value === '{') {
        init = parseInitList();
      }

      items.push({
        name: nameTok.value,
        type: itemType,
        arraySizes: arraySizes.length > 0 ? arraySizes : undefined,
        init,
        ctorArgs,
        line: nameTok.line,
        column: nameTok.column,
      });
    } while (match(','));

    if (requireSemicolon) {
      expect(';');
    }
    return { kind: 'vardecl', items, line: startTok.line, column: startTok.column };
  };

  const parseParamList = (): ParamDecl[] => {
    expect('(');
    const params: ParamDecl[] = [];
    if (peek().value === ')') {
      advance();
      return params;
    }
    // C-style `(void)` parameter list
    if (peek().value === 'void' && peek(1).value === ')') {
      advance();
      advance();
      return params;
    }

    do {
      const paramType = parseTypeSpec();
      let name = '';
      if (peek().type === 'ident') {
        name = advance().value;
      }
      let isArray = false;
      while (match('[')) {
        isArray = true;
        if (peek().value !== ']') parseExpr();
        expect(']');
      }
      if (isArray) {
        paramType.pointerDepth += 1;
      }
      let defaultValue: Expr | undefined;
      if (match('=')) {
        defaultValue = parseAssignment();
      }
      params.push({ type: paramType, name, isArray, defaultValue });
    } while (match(','));

    expect(')');
    return params;
  };

  const parseStructDecl = (): StructDecl => {
    const startTok = advance(); // struct or class
    const nameTok = peek();
    if (nameTok.type !== 'ident') {
      errorAt(nameTok, `expected struct/class name before '${nameTok.value}'`);
    }
    advance();
    userTypes.add(nameTok.value);

    const fields: VarDeclItem[] = [];
    const methods: FunctionDecl[] = [];

    if (match('{')) {
      while (peek().value !== '}' && peek().type !== 'eof') {
        if (
          (peek().value === 'public' || peek().value === 'private' || peek().value === 'protected') &&
          peek(1).value === ':'
        ) {
          advance();
          advance();
          continue;
        }
        const memberStart = peek();
        const saved = pos;
        const memberType = parseTypeSpec();
        const memberName = peek();
        if (memberName.type === 'ident' && peek(1).value === '(') {
          advance();
          const params = parseParamList();
          while (peek().value === 'const') advance();
          const body = peek().value === '{' ? parseBlock() : (expect(';'), null);
          methods.push({
            kind: 'function',
            returnType: memberType,
            name: memberName.value,
            params,
            body,
            line: memberStart.line,
            column: memberStart.column,
          });
        } else {
          pos = saved;
          const decl = parseVarDeclStmt(true);
          fields.push(...decl.items);
        }
      }
      expect('}');
    }
    expect(';');
    return {
      kind: 'struct',
      name: nameTok.value,
      fields,
      methods,
      line: startTok.line,
      column: startTok.column,
    };
  };

  const parseBlock = (): BlockStmt => {
    const startTok = expect('{');
    const stmts: Stmt[] = [];
    while (peek().value !== '}' && peek().type !== 'eof') {
      stmts.push(parseStmt());
    }
    expect('}');
    return { kind: 'block', stmts, line: startTok.line, column: startTok.column };
  };

  const parseStmt = (): Stmt => {
    const tok = peek();

    if (tok.value === ';') {
      advance();
      return { kind: 'empty', line: tok.line, column: tok.column };
    }
    if (tok.value === '{') return parseBlock();

    if (tok.value === 'if') {
      advance();
      expect('(');
      const cond = parseExpr();
      expect(')');
      const thenBranch = parseStmt();
      let elseBranch: Stmt | undefined;
      if (match('else')) {
        elseBranch = parseStmt();
      }
      return { kind: 'if', cond, thenBranch, elseBranch, line: tok.line, column: tok.column };
    }

    if (tok.value === 'while') {
      advance();
      expect('(');
      const cond = parseExpr();
      expect(')');
      const body = parseStmt();
      return { kind: 'while', cond, body, line: tok.line, column: tok.column };
    }

    if (tok.value === 'do') {
      advance();
      const body = parseStmt();
      expect('while');
      expect('(');
      const cond = parseExpr();
      expect(')');
      expect(';');
      return { kind: 'do_while', body, cond, line: tok.line, column: tok.column };
    }

    if (tok.value === 'for') {
      advance();
      expect('(');

      // Check for range-based for: `for (int x : vec)` or `for (auto &x : vec)`
      const saved = pos;
      if (isTypeStartAt(pos)) {
        try {
          const varType = parseTypeSpec();
          if (peek().type === 'ident' && peek(1).value === ':') {
            const varName = advance().value;
            advance(); // ':'
            const iterable = parseExpr();
            expect(')');
            const body = parseStmt();
            return {
              kind: 'range_for',
              varType,
              varName,
              iterable,
              body,
              line: tok.line,
              column: tok.column,
            };
          }
        } catch {
          // Fall back to classic for loop
        }
        pos = saved;
      }

      let init: Stmt | undefined;
      if (match(';')) {
        init = undefined;
      } else if (looksLikeVarDecl()) {
        init = parseVarDeclStmt(true);
      } else {
        const expr = parseExpr();
        expect(';');
        init = { kind: 'expr', expr, line: expr.line, column: expr.column };
      }

      let cond: Expr | undefined;
      if (peek().value !== ';') {
        cond = parseExpr();
      }
      expect(';');

      let update: Expr | undefined;
      if (peek().value !== ')') {
        update = parseExpr();
      }
      expect(')');

      const body = parseStmt();
      return { kind: 'for', init, cond, update, body, line: tok.line, column: tok.column };
    }

    if (tok.value === 'switch') {
      advance();
      expect('(');
      const discriminant = parseExpr();
      expect(')');
      expect('{');
      const cases: SwitchCase[] = [];
      while (peek().value !== '}' && peek().type !== 'eof') {
        if (match('case')) {
          const test = parseExpr();
          expect(':');
          const stmts: Stmt[] = [];
          while (
            peek().value !== 'case' &&
            peek().value !== 'default' &&
            peek().value !== '}' &&
            peek().type !== 'eof'
          ) {
            stmts.push(parseStmt());
          }
          cases.push({ test, stmts });
        } else if (match('default')) {
          expect(':');
          const stmts: Stmt[] = [];
          while (
            peek().value !== 'case' &&
            peek().value !== 'default' &&
            peek().value !== '}' &&
            peek().type !== 'eof'
          ) {
            stmts.push(parseStmt());
          }
          cases.push({ test: null, stmts });
        } else {
          errorAt(peek(), `expected 'case' or 'default' in switch before '${peek().value}'`);
        }
      }
      expect('}');
      return { kind: 'switch', discriminant, cases, line: tok.line, column: tok.column };
    }

    if (tok.value === 'return') {
      advance();
      let value: Expr | undefined;
      if (peek().value !== ';') {
        value = parseExpr();
      }
      expect(';');
      return { kind: 'return', value, line: tok.line, column: tok.column };
    }

    if (tok.value === 'break') {
      advance();
      expect(';');
      return { kind: 'break', line: tok.line, column: tok.column };
    }

    if (tok.value === 'continue') {
      advance();
      expect(';');
      return { kind: 'continue', line: tok.line, column: tok.column };
    }

    if (tok.value === 'using') {
      while (peek().value !== ';' && peek().type !== 'eof') advance();
      expect(';');
      return { kind: 'empty', line: tok.line, column: tok.column };
    }

    if (looksLikeVarDecl()) {
      return parseVarDeclStmt(true);
    }

    const expr = parseExpr();
    expect(';');
    return { kind: 'expr', expr, line: tok.line, column: tok.column };
  };

  const parseExpr = (): Expr => {
    let left = parseAssignment();
    while (isOpOrPunct(peek()) && peek().value === ',') {
      const opTok = advance();
      const right = parseAssignment();
      left = { kind: 'binary', op: ',', left, right, line: opTok.line, column: opTok.column };
    }
    return left;
  };

  const parseAssignment = (): Expr => {
    const left = parseTernary();
    if (isOpOrPunct(peek()) && ASSIGN_OPS.has(peek().value)) {
      const opTok = advance();
      const right = parseAssignment();
      return { kind: 'assign', op: opTok.value, left, right, line: opTok.line, column: opTok.column };
    }
    return left;
  };

  const parseTernary = (): Expr => {
    const cond = parseLogicalOr();
    if (match('?')) {
      const thenExpr = parseExpr();
      expect(':');
      const elseExpr = parseTernary();
      return { kind: 'ternary', cond, thenExpr, elseExpr, line: cond.line, column: cond.column };
    }
    return cond;
  };

  const makeBinaryParser = (ops: string[], next: () => Expr) => (): Expr => {
    let left = next();
    while (isOpOrPunct(peek()) && ops.includes(peek().value)) {
      const opTok = advance();
      const right = next();
      left = { kind: 'binary', op: opTok.value, left, right, line: opTok.line, column: opTok.column };
    }
    return left;
  };

  const parseMul = () => parseBinaryMul();
  const parseAdd = makeBinaryParser(['+', '-'], parseMul);
  const parseShift = makeBinaryParser(['<<', '>>'], parseAdd);
  const parseRel = makeBinaryParser(['<', '<=', '>', '>='], parseShift);
  const parseEq = makeBinaryParser(['==', '!='], parseRel);
  const parseBitAnd = makeBinaryParser(['&'], parseEq);
  const parseBitXor = makeBinaryParser(['^'], parseBitAnd);
  const parseBitOr = makeBinaryParser(['|'], parseBitXor);
  const parseLogicalAnd = makeBinaryParser(['&&'], parseBitOr);
  const parseLogicalOr = makeBinaryParser(['||'], parseLogicalAnd);

  const parseBinaryMul = (): Expr => {
    let left = parseUnary();
    while (isOpOrPunct(peek()) && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const opTok = advance();
      const right = parseUnary();
      left = { kind: 'binary', op: opTok.value, left, right, line: opTok.line, column: opTok.column };
    }
    return left;
  };

  const parseUnary = (): Expr => {
    const tok = peek();

    if (tok.value === 'sizeof') {
      advance();
      if (match('(')) {
        const saved = pos;
        if (isTypeStartAt(pos)) {
          try {
            const targetType = parseTypeSpec();
            if (match(')')) {
              return { kind: 'sizeof', targetType, line: tok.line, column: tok.column };
            }
          } catch {
            // Fall through to expression sizeof
          }
          pos = saved;
        }
        const expr = parseExpr();
        expect(')');
        return { kind: 'sizeof', expr, line: tok.line, column: tok.column };
      }
      return { kind: 'sizeof', expr: parseUnary(), line: tok.line, column: tok.column };
    }

    if (tok.value === 'new') {
      advance();
      const allocType = parseTypeSpec();
      if (match('[')) {
        const count = parseExpr();
        expect(']');
        return { kind: 'new', allocType, count, line: tok.line, column: tok.column };
      }
      let args: Expr[] | undefined;
      if (match('(')) {
        args = [];
        if (peek().value !== ')') {
          do {
            args.push(parseAssignment());
          } while (match(','));
        }
        expect(')');
      }
      return { kind: 'new', allocType, args, line: tok.line, column: tok.column };
    }

    if (tok.value === 'delete') {
      advance();
      const isArray = match('[') ? (expect(']'), true) : false;
      const target = parseUnary();
      return { kind: 'delete', isArray, target, line: tok.line, column: tok.column };
    }

    // C-style cast: `(double)x`, `(void*)p`, `(size_t)n`
    if (isOpOrPunct(tok) && tok.value === '(' && isTypeStartAt(pos + 1)) {
      const saved = pos;
      try {
        advance(); // '('
        const targetType = parseTypeSpec();
        if (match(')')) {
          const expr = parseUnary();
          return { kind: 'cast', targetType, expr, line: tok.line, column: tok.column };
        }
      } catch {
        // Not a cast; backtrack
      }
      pos = saved;
    }

    // C++ static_cast<T>(expr)
    if (
      (tok.type === 'keyword' || tok.type === 'ident') &&
      (tok.value === 'static_cast' ||
        tok.value === 'reinterpret_cast' ||
        tok.value === 'const_cast' ||
        tok.value === 'dynamic_cast') &&
      isOpOrPunct(peek(1)) &&
      peek(1).value === '<'
    ) {
      advance();
      expect('<');
      const targetType = parseTypeSpec();
      expect('>');
      expect('(');
      const expr = parseExpr();
      expect(')');
      return { kind: 'cast', targetType, expr, line: tok.line, column: tok.column };
    }

    if (
      isOpOrPunct(tok) &&
      (tok.value === '+' ||
        tok.value === '-' ||
        tok.value === '!' ||
        tok.value === '~' ||
        tok.value === '++' ||
        tok.value === '--' ||
        tok.value === '*' ||
        tok.value === '&')
    ) {
      advance();
      return { kind: 'unary', op: tok.value, arg: parseUnary(), line: tok.line, column: tok.column };
    }

    return parsePostfix();
  };

  const parsePostfix = (): Expr => {
    let expr = parsePrimary();

    while (true) {
      const tok = peek();
      if (!isOpOrPunct(tok)) break;

      if (tok.value === '(') {
        advance();
        const args: Expr[] = [];
        if (!isOpOrPunct(peek()) || peek().value !== ')') {
          do {
            args.push(parseAssignment());
          } while (match(','));
        }
        expect(')');
        expr = { kind: 'call', callee: expr, args, line: tok.line, column: tok.column };
        continue;
      }

      if (tok.value === '[') {
        advance();
        const index = parseExpr();
        expect(']');
        expr = { kind: 'index', target: expr, index, line: tok.line, column: tok.column };
        continue;
      }

      if (tok.value === '.' || tok.value === '->') {
        advance();
        const propTok = peek();
        if (propTok.type !== 'ident' && propTok.type !== 'keyword') {
          errorAt(propTok, `expected member name after '${tok.value}'`);
        }
        advance();
        expr = {
          kind: 'member',
          target: expr,
          prop: propTok.value,
          isArrow: tok.value === '->',
          line: tok.line,
          column: tok.column,
        };
        continue;
      }

      if (tok.value === '++' || tok.value === '--') {
        advance();
        expr = { kind: 'postfix', op: tok.value, arg: expr, line: tok.line, column: tok.column };
        continue;
      }

      break;
    }

    return expr;
  };

  const parseInitList = (): Expr => {
    const startTok = expect('{');
    const elements: Expr[] = [];
    if (peek().value !== '}') {
      do {
        if (peek().value === '}') break;
        elements.push(parseAssignment());
      } while (match(','));
    }
    expect('}');
    return { kind: 'init_list', elements, line: startTok.line, column: startTok.column };
  };

  const parsePrimary = (): Expr => {
    const tok = peek();

    if (tok.type === 'number') {
      advance();
      const isFloat = tok.value.includes('.') || /[eE]/.test(tok.value);
      const value = tok.value.startsWith('0x') || tok.value.startsWith('0X')
        ? Number.parseInt(tok.value, 16)
        : Number(tok.value);
      return { kind: 'number', value, isFloat, line: tok.line, column: tok.column };
    }

    if (tok.type === 'string') {
      advance();
      return { kind: 'string', value: tok.value, line: tok.line, column: tok.column };
    }

    if (tok.type === 'char') {
      advance();
      return { kind: 'char', value: tok.value, line: tok.line, column: tok.column };
    }

    if (tok.value === 'true' || tok.value === 'false') {
      advance();
      return { kind: 'bool', value: tok.value === 'true', line: tok.line, column: tok.column };
    }

    if (tok.value === 'nullptr' || tok.value === 'NULL') {
      advance();
      return { kind: 'null', line: tok.line, column: tok.column };
    }

    if (tok.value === '{') {
      return parseInitList();
    }

    if (tok.value === '(') {
      advance();
      const inner = parseExpr();
      expect(')');
      return inner;
    }

    // Functional type cast like `double(x)` or `int(a)`
    if (
      (tok.value === 'int' || tok.value === 'double' || tok.value === 'float' || tok.value === 'char' || tok.value === 'bool' || tok.value === 'long') &&
      peek(1).value === '('
    ) {
      advance();
      expect('(');
      const inner = parseExpr();
      expect(')');
      return {
        kind: 'cast',
        targetType: { base: tok.value, pointerDepth: 0, isRef: false, isConst: false },
        expr: inner,
        line: tok.line,
        column: tok.column,
      };
    }

    // Qualified identifier `std::cout`, `std::vector`, etc.
    if (tok.type === 'ident' || tok.value === 'this') {
      advance();
      let name = tok.value;
      while (peek().value === '::') {
        advance();
        const nextTok = peek();
        if (nextTok.type !== 'ident' && nextTok.type !== 'keyword') {
          errorAt(nextTok, `expected identifier after '::'`);
        }
        advance();
        name = name === 'std' ? nextTok.value : `${name}::${nextTok.value}`;
      }
      return { kind: 'ident', name, line: tok.line, column: tok.column };
    }

    return errorAt(tok, `expected expression before '${tok.value || 'end of input'}'`);
  };

  const declarations: TopLevelDecl[] = [];

  while (peek().type !== 'eof') {
    const tok = peek();

    if (tok.value === ';') {
      advance();
      continue;
    }

    if (tok.value === 'using') {
      while (peek().value !== ';' && peek().type !== 'eof') advance();
      expect(';');
      continue;
    }

    if (tok.value === 'typedef') {
      while (peek().value !== ';' && peek().type !== 'eof') advance();
      expect(';');
      continue;
    }

    if (tok.value === 'struct' || tok.value === 'class') {
      // Distinguish `struct Foo { ... };` from `struct Foo myFunc(...)`
      if (peek(1).type === 'ident' && (peek(2).value === '{' || peek(2).value === ';')) {
        declarations.push(parseStructDecl());
        continue;
      }
    }

    const saved = pos;
    const typeSpec = parseTypeSpec();
    const nameTok = peek();

    if (nameTok.type === 'ident' && peek(1).value === '(') {
      advance();
      const params = parseParamList();
      const body = peek().value === '{' ? parseBlock() : (expect(';'), null);
      declarations.push({
        kind: 'function',
        returnType: typeSpec,
        name: nameTok.value,
        params,
        body,
        line: tok.line,
        column: tok.column,
      });
      continue;
    }

    // Global variable declaration
    pos = saved;
    declarations.push(parseVarDeclStmt(true));
  }

  return { declarations, includes };
}
