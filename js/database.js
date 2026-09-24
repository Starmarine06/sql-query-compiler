// database.js
// Sample in-memory database used by the semantic analyzer and the change preview.

export const SAMPLE_DB = {
  tables: {
    employees: {
      name: 'employees',
      order: ['id', 'name', 'department', 'salary', 'city'],
      columns: {
        id: { type: 'INT' },
        name: { type: 'TEXT' },
        department: { type: 'TEXT' },
        salary: { type: 'INT' },
        city: { type: 'TEXT' },
      },
      rows: [
        { id: 1, name: 'Alice', department: 'Engineering', salary: 120000, city: 'Bangalore' },
        { id: 2, name: 'Bob', department: 'Engineering', salary: 95000, city: 'Chennai' },
        { id: 3, name: 'Carol', department: 'Marketing', salary: 88000, city: 'Mumbai' },
        { id: 4, name: 'Dave', department: 'Sales', salary: 72000, city: 'Delhi' },
        { id: 5, name: 'Eve', department: 'Marketing', salary: 108000, city: 'Bangalore' },
        { id: 6, name: 'Frank', department: 'Sales', salary: 64000, city: 'Pune' },
        { id: 7, name: 'Grace', department: 'Engineering', salary: 145000, city: 'Hyderabad' },
        { id: 8, name: 'Hank', department: 'HR', salary: 68000, city: 'Bangalore' },
        { id: 9, name: 'Ivy', department: 'HR', salary: 54500, city: 'Chennai' },
        { id: 10, name: 'Jake', department: 'Sales', salary: 90000, city: 'Mumbai' },
      ],
    },
    departments: {
      name: 'departments',
      order: ['id', 'name', 'budget'],
      columns: {
        id: { type: 'INT' },
        name: { type: 'TEXT' },
        budget: { type: 'INT' },
      },
      rows: [
        { id: 1, name: 'Engineering', budget: 1500000 },
        { id: 2, name: 'Marketing', budget: 800000 },
        { id: 3, name: 'Sales', budget: 600000 },
        { id: 4, name: 'HR', budget: 300000 },
      ],
    },
  },
};

export function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

export function tableColumnNames(table) {
  return table ? table.order : [];
}

export function tableRowCount(table) {
  return table ? table.rows.length : 0;
}