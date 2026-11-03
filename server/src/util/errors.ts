/** 사용자에게 그대로 보여줘도 되는 오류 (잘못된 입력 등) */
export class UserError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'UserError';
    this.status = opts.status ?? 400;
    this.code = opts.code ?? 'bad_request';
  }
}

export class NotFoundError extends UserError {
  constructor(message = '찾을 수 없습니다.') {
    super(message, { status: 404, code: 'not_found' });
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends UserError {
  constructor(message = '권한이 없습니다.') {
    super(message, { status: 403, code: 'forbidden' });
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends UserError {
  constructor(message = '디스코드 로그인이 필요합니다.') {
    super(message, { status: 401, code: 'unauthorized' });
    this.name = 'UnauthorizedError';
  }
}

export class ServiceUnavailableError extends UserError {
  constructor(message = '디스코드 봇이 오프라인입니다. 잠시 후 다시 시도해 주세요.') {
    super(message, { status: 503, code: 'unavailable' });
    this.name = 'ServiceUnavailableError';
  }
}
