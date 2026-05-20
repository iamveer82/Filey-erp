import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Minus, Plus, ShoppingCart, X, CreditCard, Search } from "lucide-react";
import NumberFlow from "@number-flow/react";
import type { Product } from "../lib/api";
import { aed } from "../lib/format";
import { cn } from "../lib/format";

export type CartLine = Product & { quantity: number };

/** Pick products from a catalog → live cart → checkout.
 *  Adapted from the InteractiveCheckout pattern: Filey tokens,
 *  real Product type (no image field — uses a category-color
 *  initial tile instead), AED money, no scale>1.02 hover (spec §9). */
export default function ProductPicker({
  products,
  onCheckout,
  busy,
}: {
  products: Product[];
  onCheckout: (lines: CartLine[], total: number) => void | Promise<void>;
  busy?: boolean;
}) {
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        (p.category ?? "").toLowerCase().includes(s)
    );
  }, [products, q]);

  const add = (p: Product) =>
    setCart((c) => {
      const ex = c.find((i) => i.id === p.id);
      return ex
        ? c.map((i) =>
            i.id === p.id ? { ...i, quantity: i.quantity + 1 } : i
          )
        : [...c, { ...p, quantity: 1 }];
    });

  const remove = (id: number) =>
    setCart((c) => c.filter((i) => i.id !== id));

  const update = (id: number, delta: number) =>
    setCart((c) =>
      c
        .map((i) =>
          i.id === id
            ? { ...i, quantity: Math.max(0, i.quantity + delta) }
            : i
        )
        .filter((i) => i.quantity > 0)
    );

  const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = cart.reduce(
    (s, i) => s + i.unit_price * i.quantity,
    0
  );

  return (
    <div className="flex gap-4 flex-col lg:flex-row">
      {/* Catalog */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
          />
          <input
            className="input pl-10"
            placeholder="Search products or SKU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {filtered.length === 0 && (
            <p className="text-sm text-brand-400 text-center py-8">
              No products match your search.
            </p>
          )}
          {filtered.map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "group flex items-center justify-between gap-3",
                "p-3 rounded-xl bg-white border border-brand-200",
                "hover:border-primary-300 transition-colors duration-200"
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-11 h-11 rounded-lg grid place-items-center text-ink font-bold text-sm shrink-0 bg-primary-100"
                  aria-hidden
                >
                  {(p.name[0] ?? "•").toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-ink truncate">
                      {p.name}
                    </h3>
                    {p.category && (
                      <span className="pill bg-brand-100 text-brand-600">
                        {p.category}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-brand-500 mt-0.5">
                    <span className="font-mono">{p.sku}</span>
                    <span>·</span>
                    <span className="font-semibold text-ink">
                      {aed(p.unit_price)}
                    </span>
                    <span>·</span>
                    <span
                      className={
                        p.quantity === 0
                          ? "text-danger font-semibold"
                          : "text-brand-400"
                      }
                    >
                      {p.quantity === 0
                        ? "out of stock"
                        : `${p.quantity} in stock`}
                    </span>
                  </div>
                </div>
              </div>
              <button
                className="btn-ghost h-9 px-3 text-xs"
                onClick={() => add(p)}
                disabled={p.quantity === 0}
              >
                <Plus size={14} /> Add
              </button>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Cart */}
      <motion.div
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full lg:w-72 shrink-0 flex flex-col rounded-2xl bg-white border border-brand-200 shadow-bento p-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <ShoppingCart size={16} className="text-brand-500" />
          <p className="text-sm font-bold text-ink">
            Cart ({totalItems})
          </p>
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-[140px]">
          {cart.length === 0 && (
            <p className="text-xs text-brand-400 text-center py-8">
              No items yet — add products from the list.
            </p>
          )}
          <AnimatePresence initial={false} mode="popLayout">
            {cart.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="flex items-center gap-3 p-2 rounded-lg bg-brand-50 mb-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink truncate">
                      {item.name}
                    </span>
                    <button
                      onClick={() => remove(item.id)}
                      aria-label={`Remove ${item.name}`}
                      className="p-1 rounded-md text-brand-400 hover:bg-white hover:text-ink transition-colors cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => update(item.id, -1)}
                        aria-label="Decrease quantity"
                        className="p-1 rounded-md text-brand-500 hover:bg-white hover:text-ink transition-colors cursor-pointer"
                      >
                        <Minus size={12} />
                      </button>
                      <motion.span
                        layout
                        className="text-xs font-semibold text-ink w-4 text-center tabular-nums"
                      >
                        {item.quantity}
                      </motion.span>
                      <button
                        onClick={() => update(item.id, 1)}
                        aria-label="Increase quantity"
                        className="p-1 rounded-md text-brand-500 hover:bg-white hover:text-ink transition-colors cursor-pointer"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <motion.span
                      layout
                      className="text-xs font-semibold text-brand-700 tabular-nums"
                    >
                      {aed(item.unit_price * item.quantity)}
                    </motion.span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <motion.div
          layout
          className="pt-3 mt-3 border-t border-brand-100"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-ink">Total</span>
            <span className="text-base font-bold text-ink tabular-nums">
              <NumberFlow
                value={totalPrice}
                format={{
                  style: "currency",
                  currency: "AED",
                  maximumFractionDigits: 2,
                }}
              />
            </span>
          </div>
          <button
            className="btn-primary w-full"
            onClick={() => onCheckout(cart, totalPrice)}
            disabled={cart.length === 0 || !!busy}
          >
            <CreditCard size={14} /> Checkout
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
