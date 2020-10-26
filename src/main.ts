import { Observable } from 'rxjs/Observable';

/**
 * BehaviorSubject 每次会将数据流中的最新值推送给接受者
 * */
import { BehaviorSubject } from 'rxjs/BehaviorSubject';

/**
 * Scheduler 调度器，用来控制事件发出顺序和速度，有以下几中类型：
 *
 * queue
 * queue 很适合用在会有递回的 operator 且具有大量资料时使用，在这个情况下 queue 能避免不必要的效能损耗。
 *
 * asap
 * 非同步的执行，浏览器其实就是 setTimeout 设为 0 秒 (在 NodeJS 中是用 process.nextTick)
 *
 * asap 因为都是在 setTimeout 中执行，所以不会有 block event loop 的问题，很适合用在永远不会退订的 observable，例如在背景下持续监听 server 送来的通知。
 *
 * async
 * 和 asap 很像，但是使用 setInterval 来运作，通常是跟时间相关的 operator 才会用到。
 *
 * animationFrame
 * 利用 Window.requestAnimationFrame 这个 API 去实作的，所以执行週期就跟 Window.requestAnimationFrame 一模一样。
 * */
import { animationFrame } from 'rxjs/scheduler/animationFrame';

import { interval } from 'rxjs/observable/interval';
import { fromEvent } from 'rxjs/observable/fromEvent';
// combineLatest 合并多个流时，使用其他流之前的最近一次数据进行合并
import { combineLatest } from 'rxjs/observable/combineLatest';
import { of } from 'rxjs/observable/of';

import {
  map,
  filter,
  scan,
  startWith,
  distinctUntilChanged,
  share,
  withLatestFrom,
  tap,
  skip,
  switchMap,
  takeWhile,
  first
} from 'rxjs/operators';

import { DIRECTIONS, SPEED, SNAKE_LENGTH, FPS, APPLE_COUNT, POINTS_PER_APPLE } from './constants';
import { Key, Point2D, Scene } from './types';

import {
  createCanvasElement,
  renderScene,
  renderApples,
  renderSnake,
  renderScore,
  renderGameOver,
  getRandomPosition,
  checkCollision
} from './canvas';

import {
  isGameOver,
  nextDirection,
  move,
  eat,
  generateSnake,
  generateApples
} from './utils';

/**
 * Create canvas element and append it to the page
 */
let canvas = createCanvasElement();
let ctx = canvas.getContext('2d');
document.body.appendChild(canvas);

/**
 * Starting values
 */
const INITIAL_DIRECTION = DIRECTIONS[Key.RIGHT];

let ticks$ = interval(SPEED);

let click$ = fromEvent(document, 'click');
let keydown$ = fromEvent(document, 'keydown');


function createGame(fps$: Observable<number>): Observable<Scene> {
  // 方向
  let direction$ = keydown$.pipe(
    map((event: KeyboardEvent) => DIRECTIONS[event.code]),
    filter(direction => !!direction),
    startWith(INITIAL_DIRECTION),
    scan(nextDirection),
    distinctUntilChanged(), // 防止重复点击
  );

  // 用于存储当前蛇的长度值
  let length$ = new BehaviorSubject<number>(SNAKE_LENGTH);

  // 将 length$ 变为 热流
  let snakeLength$ = length$.pipe(
    scan((step, snakeLength) => snakeLength + step), // 计算过程
    share()
  );

  // 蛇的长度 - 基础长度 就是分数
  let score$ = snakeLength$.pipe(
    startWith(0),
    scan((score, _) => score + POINTS_PER_APPLE),
  );

  let snake$: Observable<Array<Point2D>> = ticks$.pipe(
    withLatestFrom(direction$, snakeLength$,
      (_, direction, snakeLength) => [direction, snakeLength]),
    scan(move, generateSnake()), // 重新计算
    share()
  );

  // 苹果
  let apples$ = snake$.pipe(
    scan(eat, generateApples()),
    distinctUntilChanged(),
    share()
  );

  let appleEaten$ = apples$.pipe(
    skip(1),
    tap(() => length$.next(POINTS_PER_APPLE))
  ).subscribe();


  // 场景，依赖蛇、苹果、分数，随着变化需要更新画面
  // combineLatest可以接收多个Observable，但最后一个参数一定是callback function，
  // 这个回调函数接收的参数个数和前边传入Observable一一对应，最后需要注意：一定至少有2
  // 个Observable送出新值的时候才会执行回调函数。
  let scene$: Observable<Scene> = combineLatest(
    snake$, apples$, score$,
    (snake, apples, score) => ({ snake, apples, score }));

  // withLatestFrom其实和combineLatest很像，唯一不同的是他多了一个主从关系，即只有主Observable送出
  // 新值的时候，才会执行callback function，其他情况下不会触发回调。

  // 这里方 fps$ 触发的时候，才会取 scene$ 中最新的值
  return fps$.pipe(withLatestFrom(scene$, (_, scene) => scene));
}

let game$ = of('Start Game')
  .pipe(
    map(() => interval(1000 / FPS, animationFrame)),
    // switchMap 会取消前一个 observable 的订阅，然后订阅一个新的 observable
    switchMap(createGame),

    // 过滤操作符，其他还有：takeUntil，skipUntil，skipWhile
    takeWhile(scene => !isGameOver(scene))
  );

const startGame = () => game$.subscribe({
  // 每发出一个值，就重新绘制场景，其实是跟着 fps$ 走的
  next: (scene) => renderScene(ctx, scene),
  complete: () => {
    renderGameOver(ctx);
    click$.pipe(first()).subscribe(startGame);
  }
});

startGame();

// https://www.jianshu.com/p/16be96d69143
