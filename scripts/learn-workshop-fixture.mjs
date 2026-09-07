// Synthetic teaching material only. Never use learner documents in test artifacts.
export const workshopFixture = {
  id: "booking-relationships", title: "Design a booking system", goal: "Connect customers, bookings and rooms, then query the relationships yourself.",
  steps: ["Model the relationships", "Query a customer's bookings", "Handle shared rooms"], currentStep: 0,
  bullets: ["A customer can make several bookings.", "Each booking references one customer and one room.", "Foreign keys connect records without repeating customer details.", "A JOIN brings related records together when you need them."],
  example: "Asha books room 101. Booking 10 stores customer_id = 1 and room_id = 101.\n\nSELECT customers.name, bookings.room_id\nFROM customers JOIN bookings\nON customers.id = bookings.customer_id;",
  diagram: {
    kind: "er", title: "One booking connects two records", focus: "bookings",
    nodes: [
      { id: "customers", label: "Customer", detail: "One customer can have many bookings.", fields: ["PK id", "name", "email"] },
      { id: "bookings", label: "Booking", detail: "Foreign keys point to the customer and room for this booking.", fields: ["PK id", "FK customer_id", "FK room_id", "check_in"] },
      { id: "rooms", label: "Room", detail: "A room can appear in many bookings on different dates.", fields: ["PK id", "nightly_rate"] },
    ],
    edges: [{ from: "customers", to: "bookings", label: "1 customer : many bookings" }, { from: "rooms", to: "bookings", label: "1 room : many bookings" }],
  },
  references: [{ sourceId: `sha256:${"a".repeat(64)}`, filename: "database-lecture.pdf", unit: "page", number: 7, excerpt: "A foreign key refers to a key in another table." }],
  exercise: { kind: "choice", prompt: "Where should customer_id live?", options: ["In the Booking table", "Only in the Room table", "In a comma-separated list on Customer"], answer: 0, hints: ["Each booking needs to identify its customer.", "Store the reference on the many side of the relationship."], explanation: "Booking is the many side. Its customer_id identifies the customer without duplicating their details." },
};
export const sqlExercise = {
  kind: "sql", prompt: "List each customer's name and room_id", hints: ["Join customers to bookings on the customer id.", "Select name from customers and room_id from bookings."], explanation: "The JOIN connects each booking to its customer through customer_id.",
  tables: [
    { name: "customers", columns: [{ name: "id", type: "INTEGER" }, { name: "name", type: "TEXT" }], rows: [[1, "Asha"], [2, "Ben"]] },
    { name: "bookings", columns: [{ name: "id", type: "INTEGER" }, { name: "customer_id", type: "INTEGER" }, { name: "room_id", type: "INTEGER" }], rows: [[10, 1, 101], [11, 2, 202], [12, 1, 303]] },
  ],
  solution: "SELECT customers.name, bookings.room_id FROM customers JOIN bookings ON customers.id = bookings.customer_id",
  expectedRows: [{ name: "Asha", room_id: 101 }, { name: "Ben", room_id: 202 }, { name: "Asha", room_id: 303 }],
};
