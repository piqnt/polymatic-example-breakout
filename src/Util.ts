export class Util {
  static removeFromArray<T>(array: T[], item: T) {
    const i = array.indexOf(item);
    if (i == -1) {
      return false;
    } else {
      array.splice(i, 1);
      return true;
    }
  }
}
