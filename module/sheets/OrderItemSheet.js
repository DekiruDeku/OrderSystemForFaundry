export default class OrderItemSheet extends ItemSheet {
  get template() {
    return `systems/Order/templates/sheets/${this.item.data.type}-sheet.html`;
  }
  getData() {
    const data = super.getData();
    let sheetdata = {
      owner: this.item.isOwner,
      editable: this.isEditable,
      item: data.item, // Use data.item instead of baseData.item
      data: data.item.data.data,
      config: CONFIG.Order,
    };
    console.log("Data in getData():", data);
    console.log("Data after adding config:", sheetdata);
    return sheetdata;
  }
}
