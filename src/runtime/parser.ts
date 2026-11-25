import { CompileError, type LexResult, type Token } from './lexer';

export interface TypeSpec {
  base: string; // e.g., 'int', 'double', 'char', 'bool', 'void', 'string', 'vector', 'map', 'istringstream', struct name
  templateArgs?: TypeSpec[];
  pointerDepth: number;
  isRef: boolean;
  isConst: boolean;
  isUnsigned?: boolean;
  isStatic?: boolean;
}

export interface ParamDecl {
  type: TypeSpec;
  name: string;
  isArray?: boolean;
  defaultValue?: Expr;
}

export interface MemberInit {
  field: string;
  args: Expr[];
}

export interface ConstructorDecl {
  params: ParamDecl[];
  initializers: MemberInit[];
  body: BlockStmt | null;
  line: number;
  column: number;
}

export interface ProgramNode {
  declarations: TopLevelDecl[];
  includes: string[];
}

export type TopLevelDecl =
  | FunctionDecl
  | VarDeclStmt
  | StructDecl
  | EnumDecl;

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
  constructors: ConstructorDecl[];
  destructor?: FunctionDecl;
  methods: FunctionDecl[];
  line: number;
  column: number;
}

export interface EnumDecl {
  kind: 'enum';
  name: string;
  isClass: boolean;
  members: Array<{ name: string; value?: Expr }>;
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
  | TryCatchStmt
  | ThrowStmt
  | ReturnStmt
  | BreakStmt
  | ContinueStmt
  | EnumDecl
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
  structuredNames?: string[];
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

export interface CatchClause {
  paramType?: TypeSpec;
  paramName?: string;
  body: BlockStmt;
}

export interface TryCatchStmt {
  kind: 'try_catch';
  tryBlock: BlockStmt;
  catches: CatchClause[];
  line: number;
  column: number;
}

export interface ThrowStmt {
  kind: 'throw';
  value?: Expr;
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
  | {
      kind: 'scoped_template';
      base: string;
      templateArgs: TypeSpec[];
      member: string;
      line: number;
      column: number;
    }
  | {
      kind: 'type_construct';
      targetType: TypeSpec;
      args: Expr[];
      line: number;
      column: number;
    }
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
  'extern', 'mutable', 'struct', 'class', 'enum',
  'size_t', 'ssize_t', 'ptrdiff_t', 'streamsize',
  'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t',
  'int64_t', 'uint64_t',
  'string', 'vector', 'pair', 'map', 'unordered_map', 'set', 'unordered_set',
  'deque', 'queue', 'stack', 'list', 'array',
  'istringstream', 'ostringstream', 'stringstream',
  'ifstream', 'ofstream', 'fstream',
  'istream', 'ostream', 'iostream',
  'FILE', 'exception', 'runtime_error', 'invalid_argument', 'out_of_range',
]);

const CONSTRUCTIBLE_STL_TYPES = new Set([
  'string', 'vector', 'pair', 'map', 'unordered_map', 'set', 'unordered_set',
  'istringstream', 'ostringstream', 'stringstream',
  'ifstream', 'ofstream', 'fstream',
  'exception', 'runtime_error', 'invalid_argument', 'out_of_range',
]);

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

export function parseCpp(lex: LexResult, fileName: string): ProgramNode {
  const { includes, sourceLines } = lex;
  let tokens = lex.tokens.slice();
  let pos = 0;
  const userTypes = new Set<string>();
  const typeAliases = new Map<string, TypeSpec>();

  const saveState = () => ({ pos, tokensSnapshot: tokens.slice() });
  const restoreState = (state: { pos: number; tokensSnapshot: Token[] }) => {
    pos = state.pos;
    tokens = state.tokensSnapshot;
  };

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

  // Splits `>>` or `>>=` safely into `>` + remainder when closing template argument lists
  const expectTemplateClose = (): Token => {
    const tok = peek();
    if (isOpOrPunct(tok) && tok.value === '>') {
      return advance();
    }
    if (isOpOrPunct(tok) && tok.value === '>>') {
      tokens[pos] = { ...tok, value: '>' };
      tokens.splice(pos + 1, 0, {
        type: 'op',
        value: '>',
        line: tok.line,
        column: tok.column + 1,
      });
      return advance();
    }
    if (isOpOrPunct(tok) && tok.value === '>=') {
      tokens[pos] = { ...tok, value: '>' };
      tokens.splice(pos + 1, 0, {
        type: 'op',
        value: '=',
        line: tok.line,
        column: tok.column + 1,
      });
      return advance();
    }
    return errorAt(tok, `expected '>' before '${tok.value || 'end of input'}'`);
  };

  const isTypeStartAt = (idx: number): boolean => {
    const t = tokens[idx];
    if (!t || (t.type !== 'keyword' && t.type !== 'ident')) return false;
    if (t.value === 'std' && isOpOrPunct(tokens[idx + 1] ?? t) && tokens[idx + 1]?.value === '::') {
      const next = tokens[idx + 2];
      return Boolean(
        next &&
          (next.type === 'keyword' || next.type === 'ident') &&
          (TYPE_STARTERS.has(next.value) || userTypes.has(next.value) || typeAliases.has(next.value))
      );
    }
    return TYPE_STARTERS.has(t.value) || userTypes.has(t.value) || typeAliases.has(t.value);
  };

  const parseTemplateArgsList = (): TypeSpec[] => {
    expect('<');
    const args: TypeSpec[] = [];
    if (!(isOpOrPunct(peek()) && (peek().value === '>' || peek().value === '>>'))) {
      do {
        args.push(parseTypeSpec());
      } while (match(','));
    }
    expectTemplateClose();
    return args;
  };

  const parseTypeSpec = (): TypeSpec => {
    let isConst = false;
    let isStatic = false;
    let isUnsigned = false;
    let base = '';
    let templateArgs: TypeSpec[] | undefined;

    while (
      isSyntaxToken(peek()) &&
      (peek().value === 'const' ||
        peek().value === 'constexpr' ||
        peek().value === 'static' ||
        peek().value === 'inline' ||
        peek().value === 'extern' ||
        peek().value === 'mutable' ||
        peek().value === 'typename')
    ) {
      if (peek().value === 'const' || peek().value === 'constexpr') isConst = true;
      if (peek().value === 'static') isStatic = true;
      advance();
    }

    if (
      isSyntaxToken(peek()) &&
      (peek().value === 'struct' || peek().value === 'class' || peek().value === 'enum')
    ) {
      advance();
    }

    if (peek().value === 'std' && isOpOrPunct(peek(1)) && peek(1).value === '::') {
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
        while (peek().value === 'long' || peek().value === 'int') {
          const extra = advance().value;
          if (extra === 'long' && base === 'long') base = 'long long';
        }
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

    // Template arguments like vector<vector<int>> or map<std::string, double>
    if (isOpOrPunct(peek()) && peek().value === '<') {
      templateArgs = parseTemplateArgsList();
    }

    // Nested dependent types like std::string::size_type or std::vector<int>::iterator
    while (isOpOrPunct(peek()) && peek().value === '::') {
      advance();
      const nested = peek();
      if (nested.type !== 'ident' && nested.type !== 'keyword') {
        errorAt(nested, `expected nested type name after '::'`);
      }
      advance();
      if (nested.value === 'size_type' || nested.value === 'difference_type') {
        base = 'size_t';
        templateArgs = undefined;
      } else if (nested.value === 'iterator' || nested.value === 'const_iterator') {
        base = 'auto';
        templateArgs = undefined;
      } else {
        base = `${base}::${nested.value}`;
      }
    }

    // Expand type alias if registered (`using ll = long long;`)
    const alias = typeAliases.get(base);
    if (alias && !templateArgs) {
      base = alias.base;
      templateArgs = alias.templateArgs;
      isUnsigned = isUnsigned || Boolean(alias.isUnsigned);
      isConst = isConst || alias.isConst;
    }

    while (isSyntaxToken(peek()) && peek().value === 'const') {
      isConst = true;
      advance();
    }

    let pointerDepth = alias?.pointerDepth ?? 0;
    while (isOpOrPunct(peek()) && peek().value === '*') {
      advance();
      pointerDepth += 1;
      while (isSyntaxToken(peek()) && peek().value === 'const') advance();
    }

    let isRef = alias?.isRef ?? false;
    if (isOpOrPunct(peek()) && peek().value === '&') {
      advance();
      isRef = true;
    } else if (isOpOrPunct(peek()) && peek().value === '&&') {
      advance();
      isRef = true;
    }

    return { base, templateArgs, pointerDepth, isRef, isConst, isUnsigned, isStatic };
  };

  // Detect whether current position starts a variable declaration (vs expression)
  const looksLikeVarDecl = (): boolean => {
    if (!isTypeStartAt(pos)) return false;
    const saved = saveState();
    try {
      parseTypeSpec();
      const after = peek();
      // `int x`, `std::istringstream iss(line)`, `auto [k, v] = ...`
      const result = after.type === 'ident';
      restoreState(saved);
      return result;
    } catch {
      restoreState(saved);
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
        itemType = { ...baseType, pointerDepth: 0, isRef: false };
        while (isOpOrPunct(peek()) && peek().value === '*') {
          advance();
          itemType.pointerDepth += 1;
        }
        if (isOpOrPunct(peek()) && peek().value === '&') {
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
          arraySizes.push({
            kind: 'number',
            value: -1,
            isFloat: false,
            line: nameTok.line,
            column: nameTok.column,
          });
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
        if (!(isOpOrPunct(peek()) && peek().value === ')')) {
          do {
            ctorArgs.push(parseAssignment());
          } while (match(','));
        }
        expect(')');
      } else if (isOpOrPunct(peek()) && peek().value === '{') {
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
    if (isOpOrPunct(peek()) && peek().value === ')') {
      advance();
      return params;
    }
    // C-style `(void)` parameter list
    if (peek().value === 'void' && isOpOrPunct(peek(1)) && peek(1).value === ')') {
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
        if (!(isOpOrPunct(peek()) && peek().value === ']')) parseExpr();
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

  const parseEnumDecl = (): EnumDecl => {
    const startTok = expect('enum');
    const isClass = match('class') || match('struct');
    let name = '';
    if (peek().type === 'ident') {
      name = advance().value;
      userTypes.add(name);
    }
    // Optional underlying type `: int`
    if (match(':')) {
      parseTypeSpec();
    }
    const members: Array<{ name: string; value?: Expr }> = [];
    if (match('{')) {
      while (!(isOpOrPunct(peek()) && peek().value === '}') && peek().type !== 'eof') {
        const mTok = peek();
        if (mTok.type !== 'ident') {
          errorAt(mTok, `expected enumerator name before '${mTok.value}'`);
        }
        advance();
        let value: Expr | undefined;
        if (match('=')) {
          value = parseAssignment();
        }
        members.push({ name: mTok.value, value });
        if (!match(',')) break;
      }
      expect('}');
    }
    expect(';');
    return {
      kind: 'enum',
      name,
      isClass,
      members,
      line: startTok.line,
      column: startTok.column,
    };
  };

  const parseMemberInitializerList = (): MemberInit[] => {
    const inits: MemberInit[] = [];
    if (!match(':')) return inits;

    do {
      const fieldTok = peek();
      if (fieldTok.type !== 'ident') {
        errorAt(fieldTok, `expected member name in initializer list before '${fieldTok.value}'`);
      }
      advance();
      const args: Expr[] = [];
      if (match('(')) {
        if (!(isOpOrPunct(peek()) && peek().value === ')')) {
          do {
            args.push(parseAssignment());
          } while (match(','));
        }
        expect(')');
      } else if (match('{')) {
        if (!(isOpOrPunct(peek()) && peek().value === '}')) {
          do {
            args.push(parseAssignment());
          } while (match(','));
        }
        expect('}');
      } else {
        errorAt(peek(), `expected '(' or '{' in member initializer for '${fieldTok.value}'`);
      }
      inits.push({ field: fieldTok.value, args });
    } while (match(','));

    return inits;
  };

  const skipMethodQualifiers = () => {
    while (
      isSyntaxToken(peek()) &&
      (peek().value === 'const' ||
        peek().value === 'override' ||
        peek().value === 'final' ||
        peek().value === 'noexcept')
    ) {
      advance();
    }
  };

  const parseStructDecl = (): StructDecl => {
    const startTok = advance(); // struct or class
    const nameTok = peek();
    if (nameTok.type !== 'ident') {
      errorAt(nameTok, `expected struct/class name before '${nameTok.value}'`);
    }
    advance();
    const className = nameTok.value;
    userTypes.add(className);

    // Optional inheritance `: public Base` (parsed and skipped cleanly)
    if (match(':')) {
      do {
        if (
          peek().value === 'public' ||
          peek().value === 'private' ||
          peek().value === 'protected'
        ) {
          advance();
        }
        parseTypeSpec();
      } while (match(','));
    }

    const fields: VarDeclItem[] = [];
    const constructors: ConstructorDecl[] = [];
    const methods: FunctionDecl[] = [];
    let destructor: FunctionDecl | undefined;

    if (match('{')) {
      while (!(isOpOrPunct(peek()) && peek().value === '}') && peek().type !== 'eof') {
        if (match(';')) continue;

        if (
          (peek().value === 'public' ||
            peek().value === 'private' ||
            peek().value === 'protected') &&
          isOpOrPunct(peek(1)) &&
          peek(1).value === ':'
        ) {
          advance();
          advance();
          continue;
        }

        if (peek().value === 'using') {
          parseUsingStatement();
          continue;
        }

        if (peek().value === 'enum') {
          parseEnumDecl();
          continue;
        }

        const memberStart = peek();
        const saved = saveState();

        // Skip leading method modifiers (`explicit`, `virtual`, `inline`)
        while (
          isSyntaxToken(peek()) &&
          (peek().value === 'explicit' || peek().value === 'virtual' || peek().value === 'inline')
        ) {
          advance();
        }

        // Destructor: `~ClassName() { ... }`
        if (isOpOrPunct(peek()) && peek().value === '~' && peek(1).value === className) {
          advance();
          advance();
          const params = parseParamList();
          skipMethodQualifiers();
          let body: BlockStmt | null = null;
          if (match('=')) {
            advance(); // default / delete
            expect(';');
          } else if (isOpOrPunct(peek()) && peek().value === '{') {
            body = parseBlock();
          } else {
            expect(';');
          }
          destructor = {
            kind: 'function',
            returnType: { base: 'void', pointerDepth: 0, isRef: false, isConst: false },
            name: `~${className}`,
            params,
            body,
            line: memberStart.line,
            column: memberStart.column,
          };
          continue;
        }

        // Constructor: `ClassName(...) : init1(...), init2(...) { ... }`
        if (peek().value === className && isOpOrPunct(peek(1)) && peek(1).value === '(') {
          advance();
          const params = parseParamList();
          const initializers = parseMemberInitializerList();
          let body: BlockStmt | null = null;
          if (match('=')) {
            advance(); // default / delete
            expect(';');
          } else if (isOpOrPunct(peek()) && peek().value === '{') {
            body = parseBlock();
          } else {
            expect(';');
          }
          constructors.push({
            params,
            initializers,
            body,
            line: memberStart.line,
            column: memberStart.column,
          });
          continue;
        }

        // Regular method or field
        const memberType = parseTypeSpec();
        const memberName = peek();
        if (memberName.type === 'ident' && isOpOrPunct(peek(1)) && peek(1).value === '(') {
          advance();
          const params = parseParamList();
          skipMethodQualifiers();
          let body: BlockStmt | null = null;
          if (match('=')) {
            advance(); // 0 / default / delete
            expect(';');
          } else if (isOpOrPunct(peek()) && peek().value === '{') {
            body = parseBlock();
          } else {
            expect(';');
          }
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
          restoreState(saved);
          const decl = parseVarDeclStmt(true);
          fields.push(...decl.items);
        }
      }
      expect('}');
    }
    expect(';');
    return {
      kind: 'struct',
      name: className,
      fields,
      constructors,
      destructor,
      methods,
      line: startTok.line,
      column: startTok.column,
    };
  };

  const parseUsingStatement = () => {
    expect('using');
    // Type alias: `using ll = long long;`
    if (peek().type === 'ident' && isOpOrPunct(peek(1)) && peek(1).value === '=') {
      const aliasName = advance().value;
      advance(); // '='
      const target = parseTypeSpec();
      typeAliases.set(aliasName, target);
      userTypes.add(aliasName);
      expect(';');
      return;
    }
    while (!(isOpOrPunct(peek()) && peek().value === ';') && peek().type !== 'eof') {
      advance();
    }
    expect(';');
  };

  const parseBlock = (): BlockStmt => {
    const startTok = expect('{');
    const stmts: Stmt[] = [];
    while (!(isOpOrPunct(peek()) && peek().value === '}') && peek().type !== 'eof') {
      stmts.push(parseStmt());
    }
    expect('}');
    return { kind: 'block', stmts, line: startTok.line, column: startTok.column };
  };

  const parseStmt = (): Stmt => {
    const tok = peek();

    if (isOpOrPunct(tok) && tok.value === ';') {
      advance();
      return { kind: 'empty', line: tok.line, column: tok.column };
    }
    if (isOpOrPunct(tok) && tok.value === '{') return parseBlock();

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

      // Check for range-based for: `for (int x : vec)`, `for (auto& x : vec)`, `for (const auto& [k, v] : map)`
      const saved = saveState();
      if (isTypeStartAt(pos)) {
        try {
          const varType = parseTypeSpec();
          if (isOpOrPunct(peek()) && peek().value === '[') {
            advance();
            const structuredNames: string[] = [];
            do {
              const nameTok = peek();
              if (nameTok.type !== 'ident') throw new Error('not structured binding');
              structuredNames.push(advance().value);
            } while (match(','));
            expect(']');
            if (isOpOrPunct(peek()) && peek().value === ':') {
              advance();
              const iterable = parseExpr();
              expect(')');
              const body = parseStmt();
              return {
                kind: 'range_for',
                varType,
                varName: structuredNames[0] ?? '_',
                structuredNames,
                iterable,
                body,
                line: tok.line,
                column: tok.column,
              };
            }
          } else if (peek().type === 'ident' && isOpOrPunct(peek(1)) && peek(1).value === ':') {
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
        restoreState(saved);
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
      if (!(isOpOrPunct(peek()) && peek().value === ';')) {
        cond = parseExpr();
      }
      expect(';');

      let update: Expr | undefined;
      if (!(isOpOrPunct(peek()) && peek().value === ')')) {
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
      while (!(isOpOrPunct(peek()) && peek().value === '}') && peek().type !== 'eof') {
        if (match('case')) {
          const test = parseExpr();
          expect(':');
          const stmts: Stmt[] = [];
          while (
            peek().value !== 'case' &&
            peek().value !== 'default' &&
            !(isOpOrPunct(peek()) && peek().value === '}') &&
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
            !(isOpOrPunct(peek()) && peek().value === '}') &&
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

    if (tok.value === 'try') {
      advance();
      const tryBlock = parseBlock();
      const catches: CatchClause[] = [];
      while (match('catch')) {
        expect('(');
        let paramType: TypeSpec | undefined;
        let paramName: string | undefined;
        if (isOpOrPunct(peek()) && peek().value === '...') {
          advance();
        } else {
          paramType = parseTypeSpec();
          if (peek().type === 'ident') {
            paramName = advance().value;
          }
        }
        expect(')');
        const body = parseBlock();
        catches.push({ paramType, paramName, body });
      }
      if (catches.length === 0) {
        errorAt(peek(), `expected 'catch' after 'try' block`);
      }
      return { kind: 'try_catch', tryBlock, catches, line: tok.line, column: tok.column };
    }

    if (tok.value === 'throw') {
      advance();
      let value: Expr | undefined;
      if (!(isOpOrPunct(peek()) && peek().value === ';')) {
        value = parseExpr();
      }
      expect(';');
      return { kind: 'throw', value, line: tok.line, column: tok.column };
    }

    if (tok.value === 'return') {
      advance();
      let value: Expr | undefined;
      if (!(isOpOrPunct(peek()) && peek().value === ';')) {
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
      parseUsingStatement();
      return { kind: 'empty', line: tok.line, column: tok.column };
    }

    if (tok.value === 'enum') {
      return parseEnumDecl();
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
        const saved = saveState();
        if (isTypeStartAt(pos)) {
          try {
            const targetType = parseTypeSpec();
            if (match(')')) {
              return { kind: 'sizeof', targetType, line: tok.line, column: tok.column };
            }
          } catch {
            // Fall through to expression sizeof
          }
          restoreState(saved);
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
        if (!(isOpOrPunct(peek()) && peek().value === ')')) {
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

    // C-style cast: `(double)x`, `(unsigned char)c`, `(void*)p`, `(size_t)n`
    if (isOpOrPunct(tok) && tok.value === '(' && isTypeStartAt(pos + 1)) {
      const saved = saveState();
      try {
        advance(); // '('
        const targetType = parseTypeSpec();
        if (match(')')) {
          // Ensure this isn't `(std::numeric_limits<...>::max)()` or parenthesized type without operand
          const nextTok = peek();
          if (
            nextTok.type !== 'eof' &&
            !(
              isOpOrPunct(nextTok) &&
              (nextTok.value === ')' ||
                nextTok.value === ';' ||
                nextTok.value === ',' ||
                nextTok.value === ']' ||
                nextTok.value === '}')
            )
          ) {
            const expr = parseUnary();
            return { kind: 'cast', targetType, expr, line: tok.line, column: tok.column };
          }
        }
      } catch {
        // Not a cast; backtrack cleanly
      }
      restoreState(saved);
    }

    // C++ static_cast<T>(expr), reinterpret_cast, const_cast, dynamic_cast
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
      expectTemplateClose();
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
        if (!(isOpOrPunct(peek()) && peek().value === ')')) {
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
    if (!(isOpOrPunct(peek()) && peek().value === '}')) {
      do {
        if (isOpOrPunct(peek()) && peek().value === '}') break;
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
      const value =
        tok.value.startsWith('0x') || tok.value.startsWith('0X')
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

    if (isOpOrPunct(tok) && tok.value === '{') {
      return parseInitList();
    }

    if (isOpOrPunct(tok) && tok.value === '(') {
      advance();
      const inner = parseExpr();
      expect(')');
      return inner;
    }

    // Functional primitive cast like `double(x)`, `int(a)`, `size_t(n)`, `unsigned(x)`
    if (
      (tok.value === 'int' ||
        tok.value === 'double' ||
        tok.value === 'float' ||
        tok.value === 'char' ||
        tok.value === 'bool' ||
        tok.value === 'long' ||
        tok.value === 'short' ||
        tok.value === 'unsigned' ||
        tok.value === 'size_t') &&
      isOpOrPunct(peek(1)) &&
      peek(1).value === '('
    ) {
      advance();
      expect('(');
      const inner = parseExpr();
      expect(')');
      return {
        kind: 'cast',
        targetType: {
          base: tok.value === 'unsigned' ? 'int' : tok.value,
          pointerDepth: 0,
          isRef: false,
          isConst: false,
          isUnsigned: tok.value === 'unsigned',
        },
        expr: inner,
        line: tok.line,
        column: tok.column,
      };
    }

    // Qualified identifier, template type member (`std::numeric_limits<std::streamsize>::max`),
    // or STL type constructor (`std::string(5, 'a')`, `std::vector<int>(n, 0)`, `std::runtime_error("msg")`)
    if (tok.type === 'ident' || tok.value === 'this') {
      advance();
      let name = tok.value;

      while (isOpOrPunct(peek()) && peek().value === '::') {
        advance();
        const nextTok = peek();
        if (nextTok.type !== 'ident' && nextTok.type !== 'keyword') {
          errorAt(nextTok, `expected identifier after '::'`);
        }
        advance();
        name = name === 'std' ? nextTok.value : `${name}::${nextTok.value}`;
      }

      // Speculatively check for template arguments in expression context:
      // 1) `numeric_limits<std::streamsize>::max`
      // 2) `vector<int>(n, 0)` / `pair<int, int>(1, 2)` / `make_pair<int, int>(1, 2)`
      if (isOpOrPunct(peek()) && peek().value === '<') {
        const saved = saveState();
        try {
          const templateArgs = parseTemplateArgsList();
          if (isOpOrPunct(peek()) && peek().value === '::') {
            advance();
            const memberTok = peek();
            if (memberTok.type !== 'ident' && memberTok.type !== 'keyword') {
              errorAt(memberTok, `expected member name after '::'`);
            }
            advance();
            return {
              kind: 'scoped_template',
              base: name,
              templateArgs,
              member: memberTok.value,
              line: tok.line,
              column: tok.column,
            };
          }
          if (
            (CONSTRUCTIBLE_STL_TYPES.has(name) || userTypes.has(name)) &&
            isOpOrPunct(peek()) &&
            (peek().value === '(' || peek().value === '{')
          ) {
            const closeDelim = peek().value === '(' ? ')' : '}';
            advance();
            const args: Expr[] = [];
            if (!(isOpOrPunct(peek()) && peek().value === closeDelim)) {
              do {
                args.push(parseAssignment());
              } while (match(','));
            }
            expect(closeDelim);
            return {
              kind: 'type_construct',
              targetType: {
                base: name,
                templateArgs,
                pointerDepth: 0,
                isRef: false,
                isConst: false,
              },
              args,
              line: tok.line,
              column: tok.column,
            };
          }
          // Template function call like `std::max<double>(a, b)` or `std::min<int>(a, b)`
          if (isOpOrPunct(peek()) && peek().value === '(') {
            return { kind: 'ident', name, line: tok.line, column: tok.column };
          }
        } catch {
          // Not template args (e.g., `a < b`); backtrack cleanly!
        }
        restoreState(saved);
      }

      // Non-template STL temporary construction: `std::string(5, 'a')`, `std::runtime_error("msg")`
      if (
        CONSTRUCTIBLE_STL_TYPES.has(name) &&
        isOpOrPunct(peek()) &&
        peek().value === '('
      ) {
        advance();
        const args: Expr[] = [];
        if (!(isOpOrPunct(peek()) && peek().value === ')')) {
          do {
            args.push(parseAssignment());
          } while (match(','));
        }
        expect(')');
        return {
          kind: 'type_construct',
          targetType: { base: name, pointerDepth: 0, isRef: false, isConst: false },
          args,
          line: tok.line,
          column: tok.column,
        };
      }

      return { kind: 'ident', name, line: tok.line, column: tok.column };
    }

    return errorAt(tok, `expected expression before '${tok.value || 'end of input'}'`);
  };

  const declarations: TopLevelDecl[] = [];

  while (peek().type !== 'eof') {
    const tok = peek();

    if (isOpOrPunct(tok) && tok.value === ';') {
      advance();
      continue;
    }

    if (tok.value === 'using') {
      parseUsingStatement();
      continue;
    }

    if (tok.value === 'typedef') {
      advance();
      const target = parseTypeSpec();
      if (peek().type === 'ident') {
        const aliasName = advance().value;
        typeAliases.set(aliasName, target);
        userTypes.add(aliasName);
      }
      while (!(isOpOrPunct(peek()) && peek().value === ';') && peek().type !== 'eof') advance();
      expect(';');
      continue;
    }

    if (tok.value === 'enum') {
      declarations.push(parseEnumDecl());
      continue;
    }

    if (tok.value === 'struct' || tok.value === 'class') {
      // Distinguish `class Parser { ... };` from `struct Point makePoint(...)`
      if (
        peek(1).type === 'ident' &&
        isOpOrPunct(peek(2)) &&
        (peek(2).value === '{' || peek(2).value === ';' || peek(2).value === ':')
      ) {
        declarations.push(parseStructDecl());
        continue;
      }
    }

    const saved = saveState();
    const typeSpec = parseTypeSpec();
    const nameTok = peek();

    if (nameTok.type === 'ident' && isOpOrPunct(peek(1)) && peek(1).value === '(') {
      advance();
      const params = parseParamList();
      skipMethodQualifiers();
      const body = isOpOrPunct(peek()) && peek().value === '{' ? parseBlock() : (expect(';'), null);
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
    restoreState(saved);
    declarations.push(parseVarDeclStmt(true));
  }

  return { declarations, includes };
}
