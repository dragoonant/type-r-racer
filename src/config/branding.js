// Every real-world name the game shows lives in this one file.
//
// The circuit and the car are real, and their names are trademarks. For a
// public release without licences, change the strings here (for example to a
// fictional circuit name) and nothing else in the code needs to change.

export const BRAND = {
  gameTitle: 'Type R Racer',
  tagline: 'Time Trial',
  cars: {
    fl5: { maker: 'Honda', model: 'Civic Type R', code: 'FL5', year: '2023', engine: '2.0 L turbo, 6-speed manual, front-wheel drive' },
  },
  tracks: {
    suzuka: {
      name: 'Suzuka Circuit',
      layout: 'Grand Prix course',
      country: 'Japan',
      corners: {
        1: 'First Curve', 2: 'Second Curve', 3: 'S Curves', 4: 'S Curves', 5: 'S Curves', 6: 'Reverse Bank',
        7: 'Turn 7', 8: 'Degner 1', 9: 'Degner 2', 10: 'Turn 10', 11: 'Hairpin', 12: '200R',
        13: 'Spoon Curve', 14: 'Spoon Curve', 15: '130R', 16: 'Chicane', 17: 'Chicane', 18: 'Final Curve',
      },
    },
  },
};
