"use client";

import { useState } from "react";

export default function Faq({ items }) {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="faq">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div key={i} className={`faq__item${isOpen ? " open" : ""}`}>
            <button
              className="faq__q"
              aria-expanded={isOpen}
              onClick={() => setOpenIndex(isOpen ? null : i)}
            >
              {item.q}
            </button>
            <div
              className="faq__a"
              style={{ maxHeight: isOpen ? "400px" : "0" }}
            >
              <p>{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
