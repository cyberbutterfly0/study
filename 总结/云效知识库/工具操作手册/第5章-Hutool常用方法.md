# 第5章 Hutool 常用方法

团队项目里 Hutool 当基础工具库用（版本 5.8.48），下面这些是文档里点名的常用方法。

## 一、异常转字符串

排查问题时要打印堆栈，别用 `e.printStackTrace()`，用这个：

```java
try {
    int i = 1 / 0;
} catch (Exception e) {
    System.out.println(ExceptionUtil.stacktraceToString(e));
}
```

## 二、List 切割（批量处理用）

```java
// 按批次分割：1000 个元素分 4 批
List<List<LoanInfoBulkChargeVO>> batchTotalList = ListUtil.splitAvg(collect, bulkDeductionBatchTotal);

// 按数量分割：2000 个元素按每 200 个一组
List<List<Integer>> resultList = ListUtil.split(originalList, 200);
```

## 三、两个 List 的交并差集

```java
List<String> list1 = new ArrayList<>(List.of("a", "b", "c"));
List<String> list2 = new ArrayList<>(List.of("b", "c", "d"));

List<String> intersection = CollUtil.intersection(list1, list2);   // 交集 [b, c]
List<String> difference   = CollUtil.subtract(list1, list2);      // 差集 [a]
List<String> union        = CollUtil.union(list1, list2);         // 并集 [a, b, c, d]

boolean isEqual            = CollUtil.isEqualList(list1, list2);  // 是否完全相同
boolean isSameCollection   = CollUtil.containsAll(list1, list2);  // list1 是否包含 list2 全部元素
```

## 四、日期

### 转换

```java
String dateStr = "2020-01-23T12:23:56";
DateTime dt = DateUtil.parse(dateStr);

LocalDateTime of = LocalDateTimeUtil.of(dt);          // Date → LocalDateTime
of = LocalDateTimeUtil.ofUTC(dt.getTime());           // 时间戳 → LocalDateTime
```

### 解析

```java
LocalDateTime localDateTime = LocalDateTimeUtil.parse("2020-01-23T12:23:56");            // ISO 时间
localDateTime = LocalDateTimeUtil.parse("2020-01-23", DatePattern.NORM_DATE_PATTERN);    // 自定义格式
LocalDate localDate = LocalDateTimeUtil.parseDate("2020-01-23");                         // 转 LocalDate
localDate = LocalDateTimeUtil.parseDate("2020-01-23T12:23:56", DateTimeFormatter.ISO_DATE_TIME); // 舍弃时间
```

### 格式化（最常用）

```java
LocalDateTime ldt = LocalDateTimeUtil.parse("2020-01-23T12:23:56");
String format = LocalDateTimeUtil.format(ldt, DatePattern.NORM_DATETIME_PATTERN);
String time = LocalDateTimeUtil.format(LocalDateTimeUtil.now(), DatePattern.NORM_DATETIME_PATTERN);
```

### 偏移 / 间隔 / 一天的首尾

```java
// 增加一天（用 ChronoUnit）
LocalDateTime offset = LocalDateTimeUtil.offset(ldt, 1, ChronoUnit.DAYS);
String offsetString = LocalDateTimeUtil.format(offset, DatePattern.NORM_DATETIME_PATTERN);

// 两个日期相差多久
LocalDateTime start = LocalDateTimeUtil.parse("2019-02-02T00:00:00");
LocalDateTime end   = LocalDateTimeUtil.parse("2020-02-02T00:00:00");
Duration between = LocalDateTimeUtil.between(start, end);
between.toDays();   // 365

// 当天开始 / 结束
LocalDateTime beginOfDay = LocalDateTimeUtil.beginOfDay(ldt);
LocalDateTime endOfDay   = LocalDateTimeUtil.endOfDay(ldt);
```

## 五、HTTP 下载

```java
// 请求并转成字节数组
String fileUrl = "http://test.ydmap.cn/***";
byte[] bytes = HttpUtil.downloadBytes(fileUrl);

// 请求并下载到本地（30 秒超时）
HttpUtil.downloadFile(fileUrl, "目标文件或目录", 30 * 1000);
```
