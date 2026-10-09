from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN

def async_setup(hass: HomeAssistant) -> None:
    """Register WebSocket commands."""
    websocket_api.async_register_command(hass, ws_get_books)
    websocket_api.async_register_command(hass, ws_get_book_data)

def _get_store(hass: HomeAssistant):
    entries = hass.data.get(DOMAIN, {})
    for v in entries.values():
        if isinstance(v, dict) and "store" in v:
            return v["store"]
    return None

@websocket_api.websocket_command({
    vol.Required("type"): "budget_book/get_books"
})
@callback
def ws_get_books(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Handle get books command."""
    store = _get_store(hass)
    if not store:
        connection.send_error(msg["id"], "not_found", "Store not found")
        return

    books_summary = [
        {
            "id": b["id"],
            "name": b["name"],
            "currency": b.get("currency", "TWD"),
            "transaction_count": len(b.get("transactions", [])),
        }
        for b in store.books.values()
    ]

    connection.send_result(msg["id"], {
        "books": books_summary,
        "active_book_id": store.data.get("active_book_id")
    })

@websocket_api.websocket_command({
    vol.Required("type"): "budget_book/get_book_data",
    vol.Optional("book_id"): str,
    vol.Optional("month"): str,
})
@callback
def ws_get_book_data(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Handle get book data command."""
    store = _get_store(hass)
    if not store:
        connection.send_error(msg["id"], "not_found", "Store not found")
        return

    book_id = msg.get("book_id") or store.data.get("active_book_id")
    if not book_id or book_id not in store.books:
        connection.send_error(msg["id"], "not_found", "Book not found")
        return

    book = store.books[book_id]
    transactions = book.get("transactions", [])

    month = msg.get("month")
    if month:
        transactions = [t for t in transactions if t.get("date", "").startswith(month)]

    connection.send_result(msg["id"], {
        "book_id": book_id,
        "categories": book.get("categories", []),
        "budgets": book.get("budgets", {}),
        "recurring": book.get("recurring", []),
        "transactions": transactions,
    })
