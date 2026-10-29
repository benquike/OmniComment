// Ambient declarations for Angular SSR development
declare module 'express' {
  export interface Request {
    params: Record<string, string>;
    query: Record<string, string | undefined>;
    body: any;
    url: string;
    method: string;
  }
  export interface Response {
    status(code: number): this;
    json(body: any): this;
    send(body: any): this;
  }
  export interface Application {
    use(...args: any[]): this;
    get(path: string, ...handlers: any[]): this;
    post(path: string, ...handlers: any[]): this;
    patch(path: string, ...handlers: any[]): this;
    delete(path: string, ...handlers: any[]): this;
    listen(port: number | string, callback?: () => void): any;
  }
  function express(): Application;
  namespace express {
    export function json(): any;
    export type Request = express.Request;
    export type Response = express.Response;
  }
  export = express;
}
declare module 'cors' {
  function cors(options?: any): any;
  export = cors;
}
declare module 'rxjs' {
  export class Observable<T> {
    pipe(...operations: any[]): Observable<any>;
    subscribe(observerOrNext?: any): any;
  }
  export function map<T, R>(project: (value: T, index: number) => R): (source: Observable<T>) => Observable<R>;
}
declare module '@angular/core' {
  export interface ElementRef {
    nativeElement: any;
  }
  export interface OnInit {
    ngOnInit(): void;
  }
  export interface OnDestroy {
    ngOnDestroy(): void;
  }
  export class EventEmitter<T = any> {
    emit(value?: T): void;
    subscribe(next?: (value: T) => void, error?: (error: any) => void, complete?: () => void): any;
  }
  export function Component(config: any): ClassDecorator;
  export function Input(options?: any): PropertyDecorator;
  export function Output(bindingPropertyName?: string): PropertyDecorator;
  export function inject<T>(token: any): T;
}
declare module '@omnicomment/web-plugin' {
  export function initOmniComment(options: any): any;
}
