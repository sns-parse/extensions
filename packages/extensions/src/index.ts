/**
 * @sns-parse/extensions：纯依赖聚合包。
 *
 * 仅通过 dependencies 自动安装全部扩展碎片包；
 * 不 re-export 任何实现（避免统一入口造成耦合）。
 * 需要具体能力时，直接依赖对应的 @sns-parse/ext-* 包。
 */
export {}
